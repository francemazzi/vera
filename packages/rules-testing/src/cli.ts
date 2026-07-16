#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import { runRuleTestingApiRequest } from "./runner.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const raw = inputPath === undefined ? await readStdin() : await readFile(inputPath, "utf8");
  const result = runRuleTestingApiRequest(JSON.parse(raw) as unknown);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.passed ? 0 : 1;
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown rule-testing CLI error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
});
