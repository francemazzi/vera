#!/usr/bin/env node
import { runDemoMvp } from "./mvp.js";

async function main(): Promise<void> {
  const { report } = await runDemoMvp();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown demo MVP CLI error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
});
