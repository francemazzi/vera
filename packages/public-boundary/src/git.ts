import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ScanTarget } from "./index.js";

function git(root: string, args: readonly string[]): Buffer {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function pathsFromNullDelimited(output: Buffer): readonly string[] {
  return output
    .toString("utf8")
    .split("\0")
    .filter((value) => value.length > 0);
}

function isText(content: Buffer): boolean {
  return !content.subarray(0, 8_192).includes(0);
}

export function collectWorkingTreeTargets(root: string): readonly ScanTarget[] {
  const paths = pathsFromNullDelimited(
    git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]),
  );

  return paths.flatMap((path) => {
    const content = readFileSync(resolve(root, path));
    return isText(content)
      ? [{ path, content: content.toString("utf8"), origin: "working-tree" }]
      : [];
  });
}

export function collectIndexTargets(root: string): readonly ScanTarget[] {
  const paths = pathsFromNullDelimited(git(root, ["ls-files", "--cached", "-z"]));
  return paths.flatMap((path) => {
    try {
      const content = git(root, ["show", `:${path}`]);
      return isText(content) ? [{ path, content: content.toString("utf8"), origin: "index" }] : [];
    } /* v8 ignore next -- defensive against an index changing between Git reads */ catch {
      return [];
    }
  });
}

export function collectHistoryTargets(root: string): readonly ScanTarget[] {
  const objectLines = git(root, ["rev-list", "--objects", "HEAD"])
    .toString("utf8")
    .split("\n")
    .filter(Boolean);
  const targets: ScanTarget[] = [];

  for (const line of objectLines) {
    const separator = line.indexOf(" ");
    /* v8 ignore next -- commit and tree records do not represent file targets */
    if (separator < 0) continue;
    const objectId = line.slice(0, separator);
    const path = line.slice(separator + 1);
    if (git(root, ["cat-file", "-t", objectId]).toString("utf8").trim() !== "blob") continue;
    const content = git(root, ["cat-file", "-p", objectId]);
    if (isText(content)) {
      targets.push({
        path,
        content: content.toString("utf8"),
        origin: `history:${objectId.slice(0, 12)}`,
      });
    }
  }

  return targets;
}
