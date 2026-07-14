import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectHistoryTargets,
  collectIndexTargets,
  collectWorkingTreeTargets,
} from "../../src/git.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(root: string, args: readonly string[]): void {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}

describe("Git target collection", () => {
  it("collects text from the working tree and reachable history", () => {
    const root = mkdtempSync(join(tmpdir(), "vera-boundary-"));
    roots.push(root);
    run(root, ["init", "--quiet"]);
    run(root, ["config", "user.name", "Synthetic User"]);
    run(root, ["config", "user.email", "synthetic@example.invalid"]);
    writeFileSync(join(root, "tracked.txt"), "first\n");
    run(root, ["add", "tracked.txt"]);
    run(root, ["commit", "--quiet", "-m", "initial"]);
    writeFileSync(join(root, "tracked.txt"), "second\n");
    writeFileSync(join(root, "new.txt"), "new\n");
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    run(root, ["add", "binary.bin"]);

    expect(collectWorkingTreeTargets(root).map((target) => target.path)).toEqual([
      "new.txt",
      "tracked.txt",
    ]);
    expect(collectIndexTargets(root)).toEqual([
      expect.objectContaining({ path: "tracked.txt", content: "first\n", origin: "index" }),
    ]);
    expect(collectHistoryTargets(root)).toEqual([
      expect.objectContaining({ path: "tracked.txt", content: "first\n" }),
    ]);
  });
});
