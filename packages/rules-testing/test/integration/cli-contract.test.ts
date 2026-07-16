import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runRuleTestingApiRequest } from "../../src/index.js";
import { makeRunRequest } from "../fixtures/synthetic-suite.js";

const execFileAsync = promisify(execFile);
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("rule testing CLI contract", () => {
  it("uses the same JSON request and result contract as the API runner", async () => {
    const request = makeRunRequest();
    const directory = await mkdtemp(join(tmpdir(), "vera-rules-testing-"));
    const inputPath = join(directory, "request.json");
    await writeFile(inputPath, JSON.stringify(request), "utf8");

    try {
      const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", "src/cli.ts", inputPath], {
        cwd: packageDir,
        env: { ...process.env, NODE_OPTIONS: "--conditions=development" },
      });
      expect(JSON.parse(stdout) as unknown).toEqual(runRuleTestingApiRequest(request));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
