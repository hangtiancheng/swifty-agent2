// gRPC client for the Milvus dense-vector bridge (src/milvus/server.py).
//
// Dense-only by design. The Python original (~/Downloads/python app/kb/milvus_client.py)
// ran Milvus Standalone and pushed dense + sparse(BM25 Function) + hybrid(RRFRanker) all
// into Milvus. This bridge targets Milvus Lite (no docker) and dense only: BM25 stays
// in-process on this side (SQLite text) and hybrid is fused in store.ts with the existing
// reciprocal-rank-fusion code. The contract lives in src/milvus/kb_store.proto.
//
// proto-loader produces a dynamic client surface, so every response is validated with zod
// before use and requests are plain objects matching the proto (keepCase field names).
import path from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { z } from "zod";

import { settings } from "#/config.ts";

const PROTO_PATH = path.join(settings.root, "src", "milvus", "kb_store.proto");
const PACKAGE = "kbstorerpc";
const SERVICE = "KbStore";
const DEADLINE_MS = 15_000;

// A chunk row upserted into Milvus. `dense` is the only indexed field; the scalars are
// carried so Search can return full hits without a SQLite join.
export interface MilvusRow {
  id: number;
  dense: number[];
  question: string;
  answer: string;
  section_path: string;
  content_type: string;
  category: string;
}

// A dense-search hit. Structurally assignable to store.ts's KnowledgeHit (rerank_score is
// optional there and set later by the rerank step).
export interface MilvusHit {
  id: number;
  score: number;
  question: string;
  answer: string;
  section_path: string;
  content_type: string;
  category: string;
}

export function milvusEnabled(): boolean {
  return settings.milvusRpcUrl !== "";
}

// --- response schemas (proto-loader loaded with keepCase + longs:String) ---
const hitSchema = z.object({
  id: z.coerce.number(),
  score: z.number(),
  question: z.string(),
  answer: z.string(),
  section_path: z.string(),
  content_type: z.string(),
  category: z.string(),
});
const searchResponseSchema = z.object({ hits: z.array(hitSchema) });
const countResponseSchema = z.object({ count: z.coerce.number() });
const upsertResponseSchema = z.object({ count: z.coerce.number() });
const emptyResponseSchema = z.object({});

// --- connection (lazy singleton) ---
function isGrpcObject(value: unknown): value is grpc.GrpcObject {
  return typeof value === "object" && value !== null;
}

function isServiceCtor(value: unknown): value is grpc.ServiceClientConstructor {
  return typeof value === "function";
}

let cachedClient: grpc.Client | null = null;
let cachedService: grpc.ServiceDefinition | null = null;

function connect(): { client: grpc.Client; service: grpc.ServiceDefinition } {
  if (cachedClient !== null && cachedService !== null) {
    return { client: cachedClient, service: cachedService };
  }
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDef);
  const ns = loaded[PACKAGE];
  if (!isGrpcObject(ns)) {
    throw new Error(`milvus rpc: package "${PACKAGE}" not found in proto`);
  }
  const ctor = ns[SERVICE];
  if (!isServiceCtor(ctor)) {
    throw new Error(`milvus rpc: service "${SERVICE}" not found in proto`);
  }
  const address = settings.milvusRpcUrl.replace(/^https?:\/\//, "");
  cachedClient = new ctor(address, grpc.credentials.createInsecure());
  cachedService = ctor.service;
  return { client: cachedClient, service: cachedService };
}

// One unary call. The proto-loader serializers are `any`-typed at the boundary; the request
// is passed straight in and the response is captured as `unknown`, then validated by zod.
function unary<S extends z.ZodType>(
  method: string,
  request: Record<string, unknown>,
  schema: S,
): Promise<z.output<S>> {
  const { client, service } = connect();
  const def = service[method];
  return new Promise<z.output<S>>((resolve, reject) => {
    const deadline = new Date(Date.now() + DEADLINE_MS);
    client.makeUnaryRequest<Record<string, unknown>, unknown>(
      def.path,
      def.requestSerialize,
      (bytes: Buffer): unknown => {
        const out: unknown = def.responseDeserialize(bytes);
        return out;
      },
      request,
      { deadline },
      (error, value) => {
        if (error) {
          reject(new Error(`milvus rpc ${method} failed: ${error.details || error.message}`));
          return;
        }
        const parsed = schema.safeParse(value);
        if (!parsed.success) {
          reject(new Error(`milvus rpc ${method}: invalid response: ${parsed.error.message}`));
          return;
        }
        resolve(parsed.data);
      },
    );
  });
}

// --- public API ---
export async function upsert(rows: MilvusRow[]): Promise<number> {
  const res = await unary("Upsert", { rows }, upsertResponseSchema);
  return res.count;
}

export async function search(
  vector: number[],
  topK: number,
  category: string | null,
): Promise<MilvusHit[]> {
  const res = await unary("Search", { vector, top_k: topK, category: category ?? "" }, searchResponseSchema);
  return res.hits;
}

export async function count(): Promise<number> {
  const res = await unary("Count", {}, countResponseSchema);
  return res.count;
}

export async function drop(): Promise<void> {
  await unary("Drop", {}, emptyResponseSchema);
}

export async function flush(): Promise<void> {
  await unary("Flush", {}, emptyResponseSchema);
}
