#!/usr/bin/env node

import { resolve } from "node:path";

import { ZodError } from "zod";

import { auditDataset, datasetAuditExitCode } from "./audit.js";
import { DatasetProjectionConfigSchema } from "./schema.js";
import {
  DatasetAuditFatalError,
  readIgnoredPrivateJson,
  resolveGitRoot,
  writePrivateDatasetReport,
} from "./security.js";

interface CliOptions {
  readonly root: string;
  readonly output: string;
  readonly projection?: string;
  readonly gitRoot?: string;
}

const HELP = `Usage: vera-dataset-audit [options]

Safely audits ignored local datasets and emits metadata-only REVIEW results.

Options:
  --root <dir>         Ignored dataset root (default: datasets)
  --output <file>      Ignored private report path
                       (default: reports/private/dataset-audit/latest.json)
  --projection <file>  Optional ignored JSON projection config with explicit
                       sources, canonical collections, counts, references,
                       completeness checks, stale files, and outcome mapping
  --git-root <dir>     Git worktree root (normally auto-detected)
  --help               Show this help
`;

function argumentValue(args: readonly string[], index: number): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new DatasetAuditFatalError("CONFIG_INVALID");
  }
  return value;
}

function parseArgs(args: readonly string[]): CliOptions | "HELP" {
  let root = "datasets";
  let output = "reports/private/dataset-audit/latest.json";
  let projection: string | undefined;
  let gitRoot: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return "HELP";
    if (argument === "--root") {
      root = argumentValue(args, index);
      index += 1;
    } else if (argument === "--output") {
      output = argumentValue(args, index);
      index += 1;
    } else if (argument === "--projection") {
      projection = argumentValue(args, index);
      index += 1;
    } else if (argument === "--git-root") {
      gitRoot = argumentValue(args, index);
      index += 1;
    } else {
      throw new DatasetAuditFatalError("CONFIG_INVALID");
    }
  }
  return {
    root: resolve(root),
    output: resolve(output),
    ...(projection === undefined ? {} : { projection: resolve(projection) }),
    ...(gitRoot === undefined ? {} : { gitRoot: resolve(gitRoot) }),
  };
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options === "HELP") {
      process.stdout.write(HELP);
      return;
    }
    const gitRoot = options.gitRoot ?? (await resolveGitRoot(process.cwd()));
    const projection =
      options.projection === undefined
        ? undefined
        : DatasetProjectionConfigSchema.parse(
            await readIgnoredPrivateJson(options.projection, { gitRoot }),
          );
    const report = await auditDataset({
      root: options.root,
      gitRoot,
      ...(projection === undefined ? {} : { projection }),
    });
    await writePrivateDatasetReport(report, options.output, { gitRoot });
    const projectionWarnings =
      report.projection?.issues.filter(({ severity }) => severity === "WARNING").length ?? 0;
    const projectionErrors =
      report.projection?.issues.filter(({ severity }) => severity === "ERROR").length ?? 0;
    process.stdout.write(
      `Dataset audit complete: files=${String(report.summary.files)} warnings=${String(
        report.summary.warnings + projectionWarnings,
      )} errors=${String(report.summary.errors + projectionErrors)} review=${String(
        report.summary.review,
      )} corpusHash=${report.corpusHash} reportHash=${report.reportHash}\n`,
    );
    process.exitCode = datasetAuditExitCode(report);
  } catch (error) {
    const fatal =
      error instanceof DatasetAuditFatalError
        ? error
        : new DatasetAuditFatalError(
            error instanceof ZodError ? "CONFIG_INVALID" : "INVARIANT_VIOLATION",
            { cause: error },
          );
    process.stderr.write(`Dataset audit failed: ${fatal.code}\n`);
    process.exitCode = 2;
  }
}

await main();
