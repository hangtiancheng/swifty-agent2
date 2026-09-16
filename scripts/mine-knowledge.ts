// Mine reusable Q&A pairs from historical conversations into the staging table.
import { closeDb } from "../src/db/client.ts";
import * as mining from "../src/kb/mining.ts";

const stats = await mining.mine();
console.log(`✅ 挖知识:${JSON.stringify(stats)}`);
await closeDb();
