#!/usr/bin/env node
// @ts-check

/**
 * One-shot migration: rename the legacy chapter ids (ch01..ch10) to topic names
 * in every git-tracked file — both in file/directory names and in file contents.
 *
 * Mapping (case-sensitive; the case style of the "ch" prefix is preserved):
 *
 *   ch01 -> chat          ch06 -> intent
 *   ch02 -> tool          ch07 -> context
 *   ch03 -> db            ch08 -> mcp
 *   ch04 -> rag           ch09 -> observability
 *   ch05 -> workflow      ch10 -> train
 *
 *   e.g. ch10 -> train, CH10 -> TRAIN, Ch10 -> Train, ch10Script -> trainScript
 *
 * Usage:
 *
 *   node scripts/rename-chapters.mjs            # apply the migration
 *   node scripts/rename-chapters.mjs --dry-run  # print the plan, change nothing
 *
 * Behavior notes:
 * - Only `git ls-files` output is touched; untracked/ignored files are left alone.
 * - Content rewrites are byte-safe: bytes are round-tripped through latin1
 *   (a 1:1 byte mapping), so non-ASCII bytes survive untouched and the
 *   ASCII-only pattern can never match inside a multi-byte UTF-8 sequence.
 * - Binary files (NUL byte in the first 8 KB) are never rewritten, but their
 *   paths are still renamed.
 * - Renames run through `git mv` (destinations are mkdir-ed first) so the index
 *   stays consistent; directories left empty by renames are pruned afterwards.
 * - Destination collisions are resolved, never fatal and never overwriting: a
 *   hash of the source file's content is inserted before the extension, e.g.
 *   `scripts/eval-ch06.ts` -> `scripts/eval-intent-3f9a1c2b.ts` when
 *   `scripts/eval-intent.ts` is already taken by a different file.
 * - This script never rewrites itself, even if it later becomes tracked.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Lowercase chapter id -> lowercase topic name. */
const TOPIC_BY_CHAPTER =
  /** @type {Readonly<Record<string, string | undefined>>} */ ({
    ch01: "chat",
    ch02: "tool",
    ch03: "db",
    ch04: "rag",
    ch05: "workflow",
    ch06: "intent",
    ch07: "context",
    ch08: "mcp",
    ch09: "observability",
    ch10: "train",
  });

/** Matches ch01..ch10 with any casing of the two-letter prefix. */
const CHAPTER_PATTERN = /[cC][hH](?:0[1-9]|10)/g;

/** Hash prefix lengths tried, shortest first, before falling back to a counter. */
const HASH_LENGTHS = /** @type {readonly number[]} */ ([8, 16, 32, 64]);

/** Ceiling for the counter fallback; reaching it means the plan is broken. */
const MAX_COUNTER = 1000;

/** @typedef {{ src: string, dst: string }} Rename Repo-relative old/new path. */
/** @typedef {{ file: string, bytes: Buffer }} ContentWrite Final path + new bytes. */
/**
 * @typedef {object} PlannedFile A tracked file plus everything the plan needs.
 * @property {string} src Repo-relative tracked path.
 * @property {string} dst Path after the chapter rename, before collision resolution.
 * @property {string} digest sha256 hex of the original bytes, used for collision suffixes.
 * @property {Buffer | null} content Rewritten bytes, or null when unchanged or binary.
 */

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const SELF_PATH = fs.realpathSync(fileURLToPath(import.meta.url));

/**
 * Replacement for a single match, preserving the case style of the prefix:
 * CH10 -> TRAIN, Ch10 -> Train, ch10 (and the exotic cH10) -> train.
 * @param {string} match
 * @returns {string}
 */
function topicForMatch(match) {
  const topic = TOPIC_BY_CHAPTER[match.toLowerCase()];
  if (topic === undefined) {
    return match; // not a mapped chapter id; leave untouched
  }
  if (match[0] === "C" && match[1] === "H") {
    return topic.toUpperCase();
  }
  if (match[0] === "C") {
    return topic.charAt(0).toUpperCase() + topic.slice(1);
  }
  return topic;
}

/**
 * Replace every chXX occurrence in a string (a repo-relative path, or file
 * content decoded as latin1).
 * @param {string} text
 * @returns {string}
 */
function replaceChapters(text) {
  return text.replaceAll(CHAPTER_PATTERN, topicForMatch);
}

/**
 * Heuristic binary detection, same idea as `git grep -I`: a NUL byte in the
 * first 8 KB means "do not touch the content".
 * @param {Buffer} bytes
 * @returns {boolean}
 */
function looksBinary(bytes) {
  return bytes.subarray(0, 8192).includes(0);
}

/**
 * Build a collision-free destination by inserting a content-hash suffix before
 * the file extension: `scripts/eval-intent.ts` -> `scripts/eval-intent-3f9a1c2b.ts`.
 * The hash prefix is lengthened step by step, then a counter is appended, until
 * `isTaken` reports the candidate as free. Returns null only if every candidate
 * up to MAX_COUNTER is somehow still taken.
 * @param {string} dst desired destination, repo-relative
 * @param {string} digest sha256 hex of the source file's original bytes
 * @param {(candidate: string) => boolean} isTaken
 * @returns {string | null}
 */
function uniqueDestination(dst, digest, isTaken) {
  const ext = path.extname(dst);
  const stem = dst.slice(0, dst.length - ext.length);
  for (const length of HASH_LENGTHS) {
    const candidate = `${stem}-${digest.slice(0, length)}${ext}`;
    if (!isTaken(candidate)) {
      return candidate;
    }
  }
  for (let counter = 2; counter <= MAX_COUNTER; counter += 1) {
    const candidate = `${stem}-${digest}-${counter}${ext}`;
    if (!isTaken(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Run git in the repository root.
 * @param {string[]} args
 * @returns {string} trimmed stdout
 */
function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * All tracked files, repo-relative. NUL-separated so any filename is safe.
 * @returns {string[]}
 */
function listTrackedFiles() {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw
    .toString("utf8")
    .split("\0")
    .filter((file) => file !== "");
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const unexpected = args.find((arg) => arg !== "--dry-run");
  if (unexpected !== undefined) {
    fail(
      `unexpected argument: ${unexpected} (usage: node scripts/rename-chapters.mjs [--dry-run])`,
    );
  }

  // Phase 1: plan. Read-only; nothing is modified until the plan is built.
  /** @type {PlannedFile[]} */
  const planned = [];
  /** @type {string[]} */
  const binarySkipped = [];

  for (const src of listTrackedFiles()) {
    if (path.resolve(REPO_ROOT, src) === SELF_PATH) {
      continue; // never rewrite this script's own mapping table
    }
    const bytes = fs.readFileSync(path.resolve(REPO_ROOT, src));
    /** @type {Buffer | null} */
    let content = null;
    if (looksBinary(bytes)) {
      binarySkipped.push(src);
    } else {
      const text = bytes.toString("latin1");
      const next = replaceChapters(text);
      if (next !== text) {
        content = Buffer.from(next, "latin1");
      }
    }
    planned.push({
      src,
      dst: replaceChapters(src),
      digest: createHash("sha256").update(bytes).digest("hex"),
      content,
    });
  }

  // Phase 2: resolve destination collisions with content-hash suffixes. A
  // destination can never be a path that another rename vacates — renaming
  // strips every chXX occurrence while a vacated path must contain one — so
  // "taken" simply means "already claimed by this plan, or present on disk".
  /** @type {Set<string>} */
  const claimed = new Set();
  /** @type {Rename[]} */
  const renames = [];
  /** @type {ContentWrite[]} */
  const writes = [];
  /** @type {string[]} */
  const resolved = [];

  for (const entry of planned) {
    let dst = entry.dst;
    if (dst !== entry.src) {
      const isTaken = (
        /** @type {string} */
        candidate,
      ) =>
        claimed.has(candidate) ||
        fs.existsSync(path.resolve(REPO_ROOT, candidate));
      if (isTaken(dst)) {
        const unique = uniqueDestination(dst, entry.digest, isTaken);
        if (unique === null) {
          fail(
            `no collision-free destination for ${entry.src} (wanted ${dst})`,
          );
        }
        resolved.push(`${entry.src}: ${dst} is taken -> ${unique}`);
        dst = unique;
      }
      claimed.add(dst);
      renames.push({ src: entry.src, dst });
    }
    if (entry.content !== null) {
      writes.push({ file: dst, bytes: entry.content });
    }
  }

  console.log(
    `${dryRun ? "[dry run] " : ""}plan: ${writes.length} content rewrite(s), ` +
      `${renames.length} rename(s), ${resolved.length} collision(s) hash-resolved, ` +
      `${binarySkipped.length} binary file(s) content-skipped`,
  );
  for (const note of resolved) {
    console.log(`  resolve: ${note}`);
  }
  for (const { src, dst } of renames) {
    console.log(`  rename:  ${src} -> ${dst}`);
  }
  for (const { file } of writes) {
    console.log(`  rewrite: ${file}`);
  }
  for (const file of binarySkipped) {
    console.log(
      `  binary:  ${file} (path renamed if needed, content untouched)`,
    );
  }

  if (dryRun) {
    console.log("dry run complete; nothing was modified");
    return;
  }

  // Phase 3: apply. Renames first (git mv keeps the index consistent), then
  // content rewrites at the final paths, so `git status` shows pure renames
  // plus plain modifications.
  for (const { src, dst } of renames) {
    fs.mkdirSync(path.dirname(path.resolve(REPO_ROOT, dst)), {
      recursive: true,
    });
    try {
      git(["mv", src, dst]);
    } catch (err) {
      fail(
        `git mv ${src} -> ${dst} failed: ${err instanceof Error ? err.message : String(err)}; ` +
          "the migration may be partial — inspect with git status",
      );
    }
  }
  for (const { file, bytes } of writes) {
    fs.writeFileSync(path.resolve(REPO_ROOT, file), bytes);
  }

  // Prune directories left empty by the renames, deepest first. rmdir only
  // removes empty directories, so anything still in use survives.
  /** @type {Set<string>} */
  const staleDirs = new Set();
  for (const { src } of renames) {
    for (
      let dir = path.dirname(src);
      dir !== "." && dir !== "/";
      dir = path.dirname(dir)
    ) {
      staleDirs.add(dir);
    }
  }
  for (const dir of [...staleDirs].sort(
    (a, b) => b.split("/").length - a.split("/").length,
  )) {
    try {
      fs.rmdirSync(path.resolve(REPO_ROOT, dir));
    } catch {
      // not empty or already gone — nothing to prune
    }
  }

  console.log(
    `done: ${writes.length} file(s) rewritten, ${renames.length} path(s) renamed`,
  );
  console.log("review with: git status && git diff HEAD");
}

main();
