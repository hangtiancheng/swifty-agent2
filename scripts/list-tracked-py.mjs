#!/usr/bin/env node
// @ts-check

/**
 * List every git-tracked `.py` file in this repository.
 *
 * Usage:
 *
 *   node scripts/list-tracked-py.mjs           # one path per line (stdout)
 *   node scripts/list-tracked-py.mjs --json    # JSON array of paths
 *
 * Behavior notes:
 * - Only the git index is consulted (`git ls-files`), so untracked and
 *   ignored files never appear, and no filesystem walk is performed.
 * - Paths are printed relative to the repository root, regardless of the
 *   directory the script is invoked from.
 * - `git ls-files -z` is used, so paths containing spaces, quotes, or
 *   non-ASCII characters survive verbatim (no git-style quoting).
 * - The file count is written to stderr, keeping stdout clean for piping.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

/**
 * Run `git` inside the repository and return its trimmed stdout.
 *
 * @param {string[]} args - git subcommand and flags (execFileSync: no shell).
 * @param {string} cwd - working directory for the git invocation.
 * @returns {string} trimmed stdout of the command.
 */
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * Resolve the absolute path of the repository root containing `dir`.
 *
 * @param {string} dir - any directory inside the repository.
 * @returns {string} absolute repository root path.
 */
function repoRoot(dir) {
  return git(["rev-parse", "--show-toplevel"], dir);
}

/**
 * List all git-tracked `.py` files, relative to the repository root.
 *
 * @param {string} root - absolute repository root path.
 * @returns {string[]} tracked `.py` paths, sorted as git lists them.
 */
function listTrackedPythonFiles(root) {
  // The `*.py` pathspec matches at any depth (`*` spans `/` in git pathspecs).
  const out = git(["ls-files", "-z", "--", "*.py"], root);
  if (out === "") return [];
  return out.split("\0").filter((p) => p.length > 0);
}

function main() {
  const asJson = process.argv.includes("--json");
  const root = repoRoot(process.cwd());
  const files = listTrackedPythonFiles(root);

  if (asJson) {
    process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
  } else {
    for (const file of files) process.stdout.write(`${file}\n`);
  }
  process.stderr.write(`${files.length} tracked .py file(s)\n`);
}

main();
