import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { collectHistoryTargets, collectIndexTargets, collectWorkingTreeTargets } from "./git.js";
import { scanContents, type BoundaryConfig, type ScanTarget } from "./index.js";

function readConfig(root: string): BoundaryConfig {
  const path = process.env["VERA_BOUNDARY_CONFIG"] ?? resolve(root, "public-boundary.rules.json");
  return JSON.parse(readFileSync(path, "utf8")) as BoundaryConfig;
}

function main(): void {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const config = readConfig(root);
  const scopes = new Set(
    (process.env["VERA_BOUNDARY_SCOPES"] ?? "working,index,history")
      .split(",")
      .map((scope) => scope.trim()),
  );
  const targets: ScanTarget[] = [];
  if (scopes.has("working")) targets.push(...collectWorkingTreeTargets(root));
  if (scopes.has("index")) targets.push(...collectIndexTargets(root));
  if (scopes.has("history")) targets.push(...collectHistoryTargets(root));
  const findings = scanContents(targets, config);

  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(
        `${finding.kind} ${finding.path}:${String(finding.line)}:${String(finding.column)} ${finding.ruleId} (${finding.origin})\n`,
      );
    }
    process.stderr.write(
      `Public boundary check failed with ${String(findings.length)} finding(s).\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Public boundary check passed (${String(targets.length)} text snapshots scanned).\n`,
  );
}

main();
