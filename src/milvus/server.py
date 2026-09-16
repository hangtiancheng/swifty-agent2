"""gRPC bridge: Node (src/kb/store.ts) -> this server -> pymilvus (Milvus Lite) dense ANN.

Dense-only by design. The Python original (~/Downloads/python app/kb/milvus_client.py) ran
Milvus Standalone and pushed dense + sparse(BM25 Function) + hybrid(RRFRanker) all into
Milvus. This bridge intentionally targets Milvus Lite (no docker) and dense only: BM25 stays
in-process on the Node side (SQLite text) and hybrid is fused there with reciprocal-rank
fusion. The tech-stack difference is recorded in src/kb/store.ts and src/milvus/kb_store.proto.

All pymilvus calls are pinned to a single dedicated thread. The synchronous pymilvus gRPC
client, shared across grpcio's handler threads, intermittently returns empty results (the
same bug the Python original documented and fixed with a single-thread executor), so every
Milvus operation is serialized through one worker thread.

Run: uv run python src/milvus/server.py [--uri data/milvus/kb.db] [--port 50051] [--collection knowledge]
"""

from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import grpc

# The generated stubs live next to this file and use flat imports (import kb_store_pb2).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kb_store_pb2 as pb2
import kb_store_pb2_grpc as pb2_grpc
from pymilvus import DataType, MilvusClient

_OUTPUT = ["question", "answer", "section_path", "content_type", "category"]

# Single dedicated thread for all Milvus calls (see module docstring).
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="milvus")


class KbStoreServicer(pb2_grpc.KbStoreServicer):
    def __init__(self, uri: str, collection: str) -> None:
        self._uri = uri
        self._collection = collection
        self._client: MilvusClient | None = None
        self._ready = False  # collection exists and is loaded

    def _run(self, fn):
        # Execute fn on the dedicated Milvus thread and block for its result.
        return _EXECUTOR.submit(fn).result()

    def _get_client(self) -> MilvusClient:
        # Milvus thread only: lazily create the client on first use.
        if self._client is None:
            self._client = MilvusClient(uri=self._uri)
        return self._client

    def _ensure_collection(self, dim: int) -> None:
        # Milvus thread only: idempotent create with a model-agnostic dimension inferred
        # from the first upserted embedding (the embedding model is configurable upstream).
        client = self._get_client()
        if client.has_collection(self._collection):
            if not self._ready:
                client.load_collection(self._collection)
                self._ready = True
            return
        schema = client.create_schema(auto_id=False)
        schema.add_field("id", DataType.INT64, is_primary=True)
        schema.add_field("dense", DataType.FLOAT_VECTOR, dim=dim)
        schema.add_field("question", DataType.VARCHAR, max_length=2048)
        schema.add_field("answer", DataType.VARCHAR, max_length=8192)
        schema.add_field("section_path", DataType.VARCHAR, max_length=512)
        schema.add_field("content_type", DataType.VARCHAR, max_length=32)
        schema.add_field("category", DataType.VARCHAR, max_length=255)
        index_params = client.prepare_index_params()
        index_params.add_index(
            field_name="dense", index_type="AUTOINDEX", metric_type="COSINE"
        )
        client.create_collection(
            self._collection, schema=schema, index_params=index_params
        )
        client.load_collection(self._collection)
        self._ready = True

    def _loaded_client(self) -> MilvusClient | None:
        # Milvus thread only: return the client if the collection exists and is loaded.
        client = self._get_client()
        if not client.has_collection(self._collection):
            return None
        if not self._ready:
            client.load_collection(self._collection)
            self._ready = True
        return client

    def Upsert(self, request, context):
        rows = [
            {
                "id": int(r.id),
                "dense": list(r.dense),
                "question": r.question,
                "answer": r.answer,
                "section_path": r.section_path,
                "content_type": r.content_type,
                "category": r.category,
            }
            for r in request.rows
        ]
        if not rows:
            return pb2.UpsertResponse(count=0)

        def work() -> int:
            self._ensure_collection(len(rows[0]["dense"]))
            client = self._get_client()
            client.upsert(self._collection, rows)
            return len(rows)

        try:
            n = self._run(work)
        except Exception as exc:  # noqa: BLE001 - surface to the Node client as a gRPC error
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"upsert failed: {exc}")
            return pb2.UpsertResponse(count=0)
        return pb2.UpsertResponse(count=n)

    def Search(self, request, context):
        vector = list(request.vector)
        top_k = int(request.top_k) or 10
        category = request.category or None

        def work():
            client = self._loaded_client()
            if client is None:
                return []
            expr = f'category == "{category}"' if category else ""
            res = client.search(
                self._collection,
                data=[vector],
                anns_field="dense",
                limit=top_k,
                output_fields=_OUTPUT,
                search_params={"metric_type": "COSINE"},
                filter=expr,
            )
            return res[0] if res else []

        try:
            raw = self._run(work)
        except Exception as exc:  # noqa: BLE001
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"search failed: {exc}")
            return pb2.SearchResponse(hits=[])
        hits = [
            pb2.Hit(
                id=int(h["id"]),
                score=float(h["distance"]),
                question=h["entity"].get("question", ""),
                answer=h["entity"].get("answer", ""),
                section_path=h["entity"].get("section_path", ""),
                content_type=h["entity"].get("content_type", ""),
                category=h["entity"].get("category", ""),
            )
            for h in raw
        ]
        return pb2.SearchResponse(hits=hits)

    def Count(self, request, context):
        def work() -> int:
            client = self._loaded_client()
            if client is None:
                return 0
            res = client.query(
                self._collection, filter="id >= 0", output_fields=["count(*)"]
            )
            return int(res[0]["count(*)"]) if res else 0

        try:
            n = self._run(work)
        except Exception as exc:  # noqa: BLE001
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"count failed: {exc}")
            return pb2.CountResponse(count=0)
        return pb2.CountResponse(count=n)

    def Drop(self, request, context):
        def work() -> None:
            client = self._get_client()
            if client.has_collection(self._collection):
                client.drop_collection(self._collection)
            self._ready = False

        try:
            self._run(work)
        except Exception as exc:  # noqa: BLE001
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"drop failed: {exc}")
        return pb2.DropResponse()

    def Flush(self, request, context):
        def work() -> None:
            client = self._loaded_client()
            if client is not None:
                client.flush(self._collection)

        try:
            self._run(work)
        except Exception as exc:  # noqa: BLE001
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"flush failed: {exc}")
        return pb2.FlushResponse()


def serve(uri: str, port: int, collection: str) -> None:
    parent = os.path.dirname(os.path.abspath(uri))
    if parent:
        os.makedirs(parent, exist_ok=True)
    server = grpc.server(ThreadPoolExecutor(max_workers=8))
    pb2_grpc.add_KbStoreServicer_to_server(KbStoreServicer(uri, collection), server)
    addr = f"127.0.0.1:{port}"
    server.add_insecure_port(addr)
    server.start()
    print(
        f"Milvus dense bridge listening on {addr} (uri={uri}, collection={collection})",
        flush=True,
    )
    server.wait_for_termination()


def main() -> None:
    parser = argparse.ArgumentParser(description="Milvus Lite dense-vector gRPC bridge")
    parser.add_argument(
        "--uri", default=os.environ.get("MILVUS_DB_PATH", "data/milvus/kb.db")
    )
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("MILVUS_RPC_PORT", "50051"))
    )
    parser.add_argument(
        "--collection", default=os.environ.get("MILVUS_COLLECTION", "knowledge")
    )
    args = parser.parse_args()
    serve(args.uri, args.port, args.collection)


if __name__ == "__main__":
    main()
