import { execFileSync, spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatasetAuditReportSchema } from "../../src/index.js";
import { makeTestRepository } from "../helpers/fixtures.js";

const WORKSPACE = resolve(import.meta.dirname, "../../../..");
const CLI = resolve(import.meta.dirname, "../../dist/cli.js");
const roots: string[] = [];

function spawnErrorCode(error: Error | undefined): string {
  if (error === undefined) return "none";
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : "unknown";
}

function cliFailureDetails(result: ReturnType<typeof spawnSync>): string {
  return [
    `status=${String(result.status)}`,
    `signal=${String(result.signal)}`,
    `spawnError=${spawnErrorCode(result.error)}`,
    `stderr=${String(result.stderr)}`,
  ].join("; ");
}

beforeAll(() => {
  execFileSync("pnpm", ["--filter", "@vera/dataset-harness", "build"], {
    cwd: WORKSPACE,
    stdio: "ignore",
  });
});

afterAll(async () => {
  await Promise.all(roots.map(async (root) => rm(root, { recursive: true, force: true })));
});

describe("vera-dataset-audit CLI", () => {
  it("uses safe defaults, writes the private report, and prints only sanitized aggregates", async () => {
    const fixture = await makeTestRepository();
    roots.push(fixture.root);
    const privateValue = "CLI_PRIVATE_VALUE_MUST_NOT_LEAK";
    await writeFile(join(fixture.dataset, "input.json"), JSON.stringify({ privateValue }));

    const result = spawnSync(process.execPath, [CLI], {
      cwd: fixture.root,
      encoding: "utf8",
    });

    expect(result.status, cliFailureDetails(result)).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(
      /^Dataset audit complete: files=1 warnings=0 errors=0 review=1 corpusHash=[0-9a-f]{64} reportHash=[0-9a-f]{64}\n$/u,
    );
    expect(result.stdout).not.toContain(privateValue);
    const report = DatasetAuditReportSchema.parse(
      JSON.parse(await readFile(fixture.report, "utf8")),
    );
    expect(report.summary.review).toBe(1);
    expect(JSON.stringify(report)).not.toContain(privateValue);
  });

  it("returns 1 for continuable artifact errors after writing the report", async () => {
    const fixture = await makeTestRepository();
    roots.push(fixture.root);
    await writeFile(join(fixture.dataset, "broken.json"), "PRIVATE_BROKEN_JSON");

    const result = spawnSync(process.execPath, [CLI], {
      cwd: fixture.root,
      encoding: "utf8",
    });

    expect(result.status, cliFailureDetails(result)).toBe(1);
    expect(result.stderr, cliFailureDetails(result)).toBe("");
    expect(result.stdout).toContain("errors=1");
    expect(result.stdout).not.toContain("PRIVATE_BROKEN_JSON");
    expect(
      DatasetAuditReportSchema.parse(JSON.parse(await readFile(fixture.report, "utf8"))).summary
        .errors,
    ).toBe(1);
  });

  it("returns 2 with a controlled code for a malformed ignored projection", async () => {
    const fixture = await makeTestRepository();
    roots.push(fixture.root);
    const projection = join(fixture.privateConfig, "projection.json");
    const privateValue = "PRIVATE_CONFIG_FRAGMENT";
    await writeFile(projection, `{${privateValue}`);

    const result = spawnSync(process.execPath, [CLI, "--projection", projection], {
      cwd: fixture.root,
      encoding: "utf8",
    });

    expect(result.status, cliFailureDetails(result)).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Dataset audit failed: CONFIG_INVALID\n");
    expect(result.stderr).not.toContain(privateValue);
  });

  it("documents defaults and optional projection behavior in help", () => {
    const result = spawnSync(process.execPath, [CLI, "--help"], {
      cwd: WORKSPACE,
      encoding: "utf8",
    });

    expect(result.status, cliFailureDetails(result)).toBe(0);
    expect(result.stdout).toContain("default: datasets");
    expect(result.stdout).toContain("reports/private/dataset-audit/latest.json");
    expect(result.stdout).toContain("--projection <file>");
    expect(result.stdout).toContain("stale files");
  });
});
