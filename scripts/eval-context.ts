// context summary-prompt labeled-sample validation (a pure prompt task uses eval instead of TDD).
// Requires the chat upstream to be reachable. Run: node scripts/eval-context.ts
// Asserts: strict JSON (guaranteed by structured output), key facts kept, no fabricated
// entities, length within bounds, greetings dropped.
import { summarizeDialog } from "#/core/summarizer.ts";

// Case 1: fact retention — order id / phone number / the ask must make it into the summary
const CASE1_DIALOG = `User: Hi, are you there
Agent: Hello, this is Meow. How can I help you?
User: The cat tree I bought, order 1001, still has not arrived. When will it ship?
Agent: Order 1001 has left the Hangzhou warehouse and is expected to arrive the day after tomorrow.
User: That is too slow. My phone is 13800138000; have the courier call ahead when it arrives.
Agent: Noted; the courier will call 13800138000 before delivery.
User: By the way, how much weight can this cat tree hold?
Agent: This cat tree supports up to 15 kg.`;
const CASE1_MUST = ["1001", "13800138000", "cat tree"];
const CASE1_BAN = ["are you there", "Hello, this is Meow"]; // greetings must not survive

// Case 2: no fabrication — every numeric entity in the summary must appear in the source
const CASE2_DIALOG = `User: Can order 2002 be returned?
Agent: Order 2002 is cat food, signed for 3 days ago, within the 7-day no-reason window, so yes.
User: Then I want to return it; the reason is the cat does not like it.
Agent: Noted. Refund request recorded: order 2002, reason "the cat does not like it".`;

// Case 3: rolling merge — facts from the old summary must not be lost
const CASE3_OLD =
  "User asked about logistics for order 1001 (cat tree), left phone 13800138000 asking the courier to call before delivery; asked about the weight capacity (15 kg).";
const CASE3_DIALOG = `User: The cat tree arrived, but one post is missing.
Agent: So sorry! We can ship you a replacement post, or you can return the whole order. Which do you prefer?
User: Send the replacement.
Agent: Noted. A replacement post for order 1001 is registered and will ship within 3 days.`;
const CASE3_MUST = ["1001", "13800138000", "post"]; // old fact (phone) + new fact (replacement post)

// NOTE: the Python original capped the summary at 250 Chinese characters; the English prompt
// asks for "a few dozen to one or two hundred words", so the bound is scaled to characters.
const MIN_LEN = 20;
const MAX_LEN = 1200;

interface CheckOptions {
  must?: string[];
  ban?: string[];
  srcDigits?: string;
}

function check(
  name: string,
  summary: string,
  options: CheckOptions = {},
): boolean {
  let ok = true;
  const problems: string[] = [];
  if (summary.length < MIN_LEN || summary.length > MAX_LEN) {
    ok = false;
    problems.push(
      `length ${summary.length} out of bounds [${MIN_LEN}, ${MAX_LEN}]`,
    );
  }
  for (const kw of options.must ?? []) {
    if (!summary.includes(kw)) {
      ok = false;
      problems.push(`key fact lost: ${kw}`);
    }
  }
  for (const kw of options.ban ?? []) {
    if (summary.includes(kw)) {
      ok = false;
      problems.push(`greeting residue: ${kw}`);
    }
  }
  if (options.srcDigits) {
    const srcNums = new Set(options.srcDigits.match(/\d{4,}/g) ?? []);
    for (const n of new Set(summary.match(/\d{4,}/g) ?? [])) {
      if (!srcNums.has(n)) {
        ok = false;
        problems.push(`fabricated numeric entity: ${n}`);
      }
    }
  }
  console.log(`${ok ? "✅" : "❌"} ${name} len=${summary.length}`);
  console.log(`   summary: ${summary}`);
  if (problems.length > 0) {
    console.log(`   problems: ${JSON.stringify(problems)}`);
  }
  return ok;
}

async function main(): Promise<void> {
  const results: boolean[] = [];
  const s1 = await summarizeDialog("", CASE1_DIALOG);
  results.push(
    check("Case 1 fact retention + greetings dropped", s1, {
      must: CASE1_MUST,
      ban: CASE1_BAN,
      srcDigits: CASE1_DIALOG,
    }),
  );
  const s2 = await summarizeDialog("", CASE2_DIALOG);
  results.push(
    check("Case 2 no fabrication (numeric entities ⊆ source)", s2, {
      must: ["2002"],
      srcDigits: CASE2_DIALOG,
    }),
  );
  const s3 = await summarizeDialog(CASE3_OLD, CASE3_DIALOG);
  results.push(
    check("Case 3 rolling merge keeps old facts", s3, {
      must: CASE3_MUST,
      srcDigits: CASE3_OLD + CASE3_DIALOG,
    }),
  );
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exitCode = results.every(Boolean) ? 0 : 1;
}

await main();
