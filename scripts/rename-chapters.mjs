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
 * - Any rename whose destination already exists (on disk, or as another
 *   rename's destination) aborts the whole run before anything is modified.
 * - This script never rewrites itself, even if it later becomes tracked.
 */

import { execFileSync } from "node:child_process";
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

/** @typedef {{ src: string, dst: string }} Rename Repo-relative old/new path. */
/** @typedef {{ file: string, bytes: Buffer }} ContentWrite Final path + new bytes. */

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

  // Phase 1: plan. Read-only; nothing is modified until the plan validates.
  /** @type {Rename[]} */
  const renames = [];
  /** @type {ContentWrite[]} */
  const writes = [];
  /** @type {string[]} */
  const binarySkipped = [];

  for (const file of listTrackedFiles()) {
    if (path.resolve(REPO_ROOT, file) === SELF_PATH) {
      continue; // never rewrite this script's own mapping table
    }
    const dst = replaceChapters(file);
    const renamed = dst !== file;
    if (renamed) {
      renames.push({ src: file, dst });
    }
    const bytes = fs.readFileSync(path.resolve(REPO_ROOT, file));
    if (looksBinary(bytes)) {
      binarySkipped.push(file);
      continue;
    }
    const text = bytes.toString("latin1");
    const next = replaceChapters(text);
    if (next !== text) {
      writes.push({
        file: renamed ? dst : file,
        bytes: Buffer.from(next, "latin1"),
      });
    }
  }

  // Validate: no destination may collide with an existing file (unless that
  // file is itself being renamed away) or with another rename's destination.
  /** @type {string[]} */
  const collisions = [];
  const sources = new Set(renames.map((rename) => rename.src));
  /** @type {Set<string>} */
  const seenDestinations = new Set();
  for (const { src, dst } of renames) {
    if (seenDestinations.has(dst)) {
      collisions.push(`${src} -> ${dst} (duplicate destination)`);
    }
    seenDestinations.add(dst);
    if (fs.existsSync(path.resolve(REPO_ROOT, dst)) && !sources.has(dst)) {
      collisions.push(`${src} -> ${dst} (destination already exists)`);
    }
  }

  console.log(
    `${dryRun ? "[dry run] " : ""}plan: ${writes.length} content rewrite(s), ` +
      `${renames.length} rename(s), ${binarySkipped.length} binary file(s) content-skipped`,
  );
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

  if (collisions.length > 0) {
    for (const collision of collisions) {
      console.error(`collision: ${collision}`);
    }
    fail(
      "resolve the collisions above first (rename or remove one side); nothing was modified",
    );
  }
  if (dryRun) {
    console.log("dry run complete; nothing was modified");
    return;
  }

  // Phase 2: apply. Renames first (git mv keeps the index consistent), then
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
