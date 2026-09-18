"""pymilvus Milvus Lite smoke script: drop and recreate the demo collection.

Standalone sanity check that the pinned pymilvus version can open a Milvus Lite
database and manage a collection; the production bridge is src/milvus/server.py
(start it with `make milvus-up`). Run: `uv run python src/milvus/main.py`.
"""

from pymilvus import MilvusClient

client: MilvusClient = MilvusClient("milvus-lite.db")

if client.has_collection(collection_name="knowledge"):
    client.drop_collection(collection_name="knowledge")

client.create_collection(
    collection_name="knowledge",
    dimension=768,  # The vectors we will use in this demo has 768 dimensions
)
