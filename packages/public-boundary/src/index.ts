import { createHash } from "node:crypto";

export type FindingKind = "FORBIDDEN_TOKEN" | "PRIVATE_PATH" | "POTENTIAL_SECRET";

export interface ScanTarget {
  readonly path: string;
  readonly content: string;
  readonly origin?: string;
}

export interface BoundaryConfig {
  readonly forbiddenTokenHashes: readonly string[];
  readonly forbiddenPathSegments: readonly string[];
  readonly allowPaths: readonly string[];
}

export interface BoundaryFinding {
  readonly kind: FindingKind;
  readonly ruleId: string;
  readonly path: string;
  readonly origin: string;
  readonly line: number;
  readonly column: number;
  readonly fingerprint: string;
}

interface SecretRule {
  readonly id: string;
  readonly pattern: RegExp;
}

const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu;

const SECRET_RULES: readonly SecretRule[] = [
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: "openai-token", pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
];

export function hashToken(token: string): string {
  return createHash("sha256").update(token.normalize("NFC").toLocaleLowerCase("und")).digest("hex");
}

function fingerprint(kind: FindingKind, ruleId: string, path: string, line: number): string {
  return createHash("sha256")
    .update(`${kind}\0${ruleId}\0${path}\0${String(line)}`)
    .digest("hex")
    .slice(0, 16);
}

function locationAt(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function addFinding(
  findings: BoundaryFinding[],
  target: ScanTarget,
  kind: FindingKind,
  ruleId: string,
  offset: number,
): void {
  const { line, column } = locationAt(target.content, offset);
  findings.push({
    kind,
    ruleId,
    path: target.path,
    origin: target.origin ?? "working-tree",
    line,
    column,
    fingerprint: fingerprint(kind, ruleId, target.path, line),
  });
}

export function scanContents(
  targets: readonly ScanTarget[],
  config: BoundaryConfig,
): readonly BoundaryFinding[] {
  const forbiddenHashes = new Set(config.forbiddenTokenHashes);
  const allowPaths = new Set(config.allowPaths);
  const findings: BoundaryFinding[] = [];

  for (const target of targets) {
    const normalizedPath = target.path.replaceAll("\\", "/");
    const pathAllowed = allowPaths.has(normalizedPath);
    if (!pathAllowed) {
      for (const segment of config.forbiddenPathSegments) {
        const index = normalizedPath.indexOf(segment);
        if (index >= 0)
          addFinding(findings, target, "PRIVATE_PATH", `path:${hashToken(segment)}`, 0);
      }
    }

    // Allowlisted paths may document private-domain terms (for example the
    // private LABEL runner) without failing the publishable-tree gate.
    if (!pathAllowed) {
      TOKEN_PATTERN.lastIndex = 0;
      for (const match of target.content.matchAll(TOKEN_PATTERN)) {
        const token = match[0];
        const tokenHash = hashToken(token);
        if (forbiddenHashes.has(tokenHash)) {
          addFinding(findings, target, "FORBIDDEN_TOKEN", `token:${tokenHash}`, match.index);
        }
      }
    }

    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of target.content.matchAll(rule.pattern)) {
        addFinding(findings, target, "POTENTIAL_SECRET", `secret:${rule.id}`, match.index);
      }
    }
  }

  return findings.toSorted((left, right) =>
    [left.path, left.origin, left.line, left.column, left.ruleId]
      .join("\0")
      .localeCompare([right.path, right.origin, right.line, right.column, right.ruleId].join("\0")),
  );
}
