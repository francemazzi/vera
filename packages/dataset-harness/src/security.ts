import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { DatasetAuditReportSchema, type DatasetAuditReport } from "./schema.js";

const execFileAsync = promisify(execFile);

export type DatasetAuditFatalCode =
  | "CONFIG_INVALID"
  | "GIT_CHECK_FAILED"
  | "INPUT_NOT_IGNORED"
  | "INVARIANT_VIOLATION"
  | "OUTPUT_NOT_IGNORED"
  | "PATH_ESCAPE"
  | "PRIVACY_GUARD_FAILED"
  | "RESOURCE_LIMIT"
  | "SYMLINK_REJECTED";

const FATAL_MESSAGES: Readonly<Record<DatasetAuditFatalCode, string>> = {
  CONFIG_INVALID: "Dataset audit configuration is invalid",
  GIT_CHECK_FAILED: "Dataset audit Git privacy check failed",
  INPUT_NOT_IGNORED: "Dataset input must be ignored by Git",
  INVARIANT_VIOLATION: "Dataset audit invariant failed",
  OUTPUT_NOT_IGNORED: "Dataset report output must be ignored by Git",
  PATH_ESCAPE: "Dataset path escapes the permitted root",
  PRIVACY_GUARD_FAILED: "Dataset audit privacy guard failed",
  RESOURCE_LIMIT: "Dataset audit resource limit exceeded",
  SYMLINK_REJECTED: "Dataset audit rejects symbolic links",
};

export class DatasetAuditFatalError extends Error {
  public readonly code: DatasetAuditFatalCode;

  public constructor(code: DatasetAuditFatalCode, options?: ErrorOptions) {
    super(FATAL_MESSAGES[code], options);
    this.name = "DatasetAuditFatalError";
    this.code = code;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    throw new DatasetAuditFatalError("GIT_CHECK_FAILED", { cause: error });
  }
}

export async function resolveGitRoot(start: string): Promise<string> {
  const discovered = await gitOutput(start, ["rev-parse", "--show-toplevel"]);
  try {
    return await realpath(discovered);
  } catch (error) {
    throw new DatasetAuditFatalError("GIT_CHECK_FAILED", { cause: error });
  }
}

async function isGitIgnored(gitRoot: string, candidate: string): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", gitRoot, "check-ignore", "--no-index", "--quiet", "--", candidate],
      { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true },
    );
    return true;
  } catch (error) {
    const exitCode = (error as { readonly code?: unknown }).code;
    if (exitCode === 1) return false;
    throw new DatasetAuditFatalError("GIT_CHECK_FAILED", { cause: error });
  }
}

async function assertNotTracked(gitRoot: string, candidates: readonly string[]): Promise<void> {
  for (let offset = 0; offset < candidates.length; offset += 50) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        [
          "-C",
          gitRoot,
          "ls-files",
          "--cached",
          "-z",
          "--",
          ...candidates.slice(offset, offset + 50),
        ],
        { encoding: "buffer", maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      );
      if (stdout.byteLength > 0) throw new DatasetAuditFatalError("PRIVACY_GUARD_FAILED");
    } catch (error) {
      if (error instanceof DatasetAuditFatalError) throw error;
      throw new DatasetAuditFatalError("GIT_CHECK_FAILED", { cause: error });
    }
  }
}

export async function assertIgnoredInput(
  rootInput: string,
  gitRootInput?: string,
): Promise<{ readonly root: string; readonly gitRoot: string }> {
  let root: string;
  try {
    const stat = await lstat(rootInput);
    if (stat.isSymbolicLink()) throw new DatasetAuditFatalError("SYMLINK_REJECTED");
    if (!stat.isDirectory()) throw new DatasetAuditFatalError("CONFIG_INVALID");
    root = await realpath(rootInput);
  } catch (error) {
    if (error instanceof DatasetAuditFatalError) throw error;
    throw new DatasetAuditFatalError("CONFIG_INVALID", { cause: error });
  }
  const gitRoot =
    gitRootInput === undefined ? await resolveGitRoot(root) : await realpath(gitRootInput);
  if (!isWithin(gitRoot, root)) throw new DatasetAuditFatalError("PATH_ESCAPE");
  if (!(await isGitIgnored(gitRoot, root))) {
    throw new DatasetAuditFatalError("INPUT_NOT_IGNORED");
  }
  await assertNotTracked(gitRoot, [root]);
  return { root, gitRoot };
}

/** Verifies every discovered file so nested .gitignore negations cannot reopen the corpus. */
export async function assertIgnoredPaths(
  gitRoot: string,
  candidates: readonly string[],
): Promise<void> {
  for (let offset = 0; offset < candidates.length; offset += 200) {
    const batch = candidates.slice(offset, offset + 200);
    const stdout = await new Promise<Buffer>((fulfill, reject) => {
      const child = spawn("git", ["-C", gitRoot, "check-ignore", "--no-index", "--stdin", "-z"], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 2 * 1024 * 1024) {
          child.kill();
          reject(new DatasetAuditFatalError("GIT_CHECK_FAILED"));
          return;
        }
        chunks.push(chunk);
      });
      child.once("error", (error) => {
        reject(new DatasetAuditFatalError("GIT_CHECK_FAILED", { cause: error }));
      });
      child.once("close", (code) => {
        if (code !== 0 && code !== 1) {
          reject(new DatasetAuditFatalError("GIT_CHECK_FAILED"));
          return;
        }
        fulfill(Buffer.concat(chunks));
      });
      child.stdin.end(Buffer.from(`${batch.join("\0")}\0`, "utf8"));
    });
    const ignored = new Set(stdout.toString("utf8").split("\0").filter(Boolean));
    if (batch.some((candidate) => !ignored.has(candidate))) {
      throw new DatasetAuditFatalError("INPUT_NOT_IGNORED");
    }
    await assertNotTracked(gitRoot, batch);
  }
}

async function assertNoSymlinkSegments(gitRoot: string, candidate: string): Promise<void> {
  const path = relative(gitRoot, candidate);
  if (!isWithin(gitRoot, candidate)) throw new DatasetAuditFatalError("PATH_ESCAPE");
  let cursor = gitRoot;
  for (const segment of path.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new DatasetAuditFatalError("SYMLINK_REJECTED");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function assertIgnoredOutput(
  outputInput: string,
  gitRootInput?: string,
): Promise<{ readonly output: string; readonly gitRoot: string }> {
  const lexicalOutput = resolve(outputInput);
  const lexicalGitRoot =
    gitRootInput === undefined ? await resolveGitRoot(process.cwd()) : resolve(gitRootInput);
  const gitRoot = await realpath(lexicalGitRoot);
  const output = isWithin(lexicalGitRoot, lexicalOutput)
    ? resolve(gitRoot, relative(lexicalGitRoot, lexicalOutput))
    : lexicalOutput;
  if (!isWithin(gitRoot, output)) throw new DatasetAuditFatalError("PATH_ESCAPE");
  await assertNoSymlinkSegments(gitRoot, output);
  if (!(await isGitIgnored(gitRoot, output))) {
    throw new DatasetAuditFatalError("OUTPUT_NOT_IGNORED");
  }
  await assertNotTracked(gitRoot, [output]);
  return { output, gitRoot };
}

export async function readIgnoredPrivateJson(
  input: string,
  options: { readonly gitRoot?: string; readonly maxBytes?: number } = {},
): Promise<unknown> {
  const lexicalCandidate = resolve(input);
  const lexicalGitRoot =
    options.gitRoot === undefined ? await resolveGitRoot(process.cwd()) : resolve(options.gitRoot);
  const gitRoot = await realpath(lexicalGitRoot);
  let initialStat;
  let canonicalCandidate: string;
  try {
    initialStat = await lstat(lexicalCandidate);
    if (initialStat.isSymbolicLink()) throw new DatasetAuditFatalError("SYMLINK_REJECTED");
    canonicalCandidate = await realpath(lexicalCandidate);
  } catch (error) {
    if (error instanceof DatasetAuditFatalError) throw error;
    throw new DatasetAuditFatalError("CONFIG_INVALID", { cause: error });
  }
  const candidate = isWithin(lexicalGitRoot, lexicalCandidate)
    ? resolve(gitRoot, relative(lexicalGitRoot, lexicalCandidate))
    : canonicalCandidate;
  if (!isWithin(gitRoot, candidate)) throw new DatasetAuditFatalError("PATH_ESCAPE");
  await assertNoSymlinkSegments(gitRoot, candidate);
  if (!(await isGitIgnored(gitRoot, candidate))) {
    throw new DatasetAuditFatalError("INPUT_NOT_IGNORED");
  }
  await assertNotTracked(gitRoot, [candidate]);
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await lstat(candidate);
    if (before.isSymbolicLink()) throw new DatasetAuditFatalError("SYMLINK_REJECTED");
    if (!before.isFile() || before.size > maxBytes)
      throw new DatasetAuditFatalError("CONFIG_INVALID");
    handle = await open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new DatasetAuditFatalError("INVARIANT_VIOLATION");
    }
    const text = await handle.readFile({ encoding: "utf8" });
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new DatasetAuditFatalError("CONFIG_INVALID", { cause: error });
    }
  } catch (error) {
    if (error instanceof DatasetAuditFatalError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new DatasetAuditFatalError("SYMLINK_REJECTED", { cause: error });
    }
    throw new DatasetAuditFatalError("CONFIG_INVALID", { cause: error });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Writes only a schema-verified, metadata-only report via an atomic same-directory rename. */
export async function writePrivateDatasetReport(
  reportInput: DatasetAuditReport,
  outputInput: string,
  options: { readonly gitRoot?: string } = {},
): Promise<void> {
  const report = DatasetAuditReportSchema.parse(reportInput);
  const { output, gitRoot } = await assertIgnoredOutput(outputInput, options.gitRoot);
  const parent = dirname(output);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertNoSymlinkSegments(gitRoot, parent);
  await chmod(parent, 0o700);

  try {
    const existing = await lstat(output);
    if (existing.isSymbolicLink()) throw new DatasetAuditFatalError("SYMLINK_REJECTED");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = `${output}.tmp-${process.pid.toString(10)}-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o600);
    await rename(temporary, output);
    await chmod(output, 0o600);
    const directory = await open(parent, fsConstants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
