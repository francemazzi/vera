import { sha256Bytes, sha256CanonicalJson } from "@vera/contracts";
import type { JsonValue } from "@vera/contracts";

import { SYNTHETIC_BENCHMARK_SCHEMA_VERSION, SyntheticBenchmarkCorpusSchema } from "./schema.js";
import type {
  BenchmarkOutcome,
  BenchmarkSplit,
  SyntheticBenchmarkCase,
  SyntheticBenchmarkCorpus,
  SyntheticDocument,
} from "./schema.js";

const CASE_COUNT = 20;
const SPLIT_SEED = 42;
const OUTCOMES: readonly BenchmarkOutcome[] = ["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"];

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function document(
  id: string,
  caseId: string,
  kind: SyntheticDocument["kind"],
  mediaType: SyntheticDocument["mediaType"],
  body: string,
): SyntheticDocument {
  const payload = bytes(body);
  return {
    id,
    caseId,
    kind,
    mediaType,
    byteLength: payload.byteLength,
    sha256: sha256Bytes(payload),
    validationScope: "TECHNICAL_DEMO",
  };
}

function pdfBody(caseId: string, outcome: BenchmarkOutcome): string {
  const text = `Synthetic VERA benchmark ${caseId} expected ${outcome}`;
  return [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R >> endobj",
    `4 0 obj << /Length ${String(text.length + 35)} >> stream`,
    `BT /F1 12 Tf 20 80 Td (${text}) Tj ET`,
    "endstream endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n");
}

function imageBody(caseId: string, outcome: BenchmarkOutcome): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" role="img">',
    `<title>Synthetic benchmark ${caseId}</title>`,
    '<rect width="320" height="160" fill="#f8fafc"/>',
    '<rect x="16" y="16" width="288" height="128" fill="#ffffff" stroke="#0f172a"/>',
    `<text x="28" y="72" font-family="monospace" font-size="16">${caseId}</text>`,
    `<text x="28" y="104" font-family="monospace" font-size="14">${outcome}</text>`,
    "</svg>",
  ].join("");
}

function jsonBody(
  caseId: string,
  outcome: BenchmarkOutcome,
  facts: Record<string, JsonValue>,
): string {
  return JSON.stringify({
    caseId,
    expectedOutcome: outcome,
    facts,
    synthetic: true,
    validationScope: "TECHNICAL_DEMO",
  });
}

function splitForIndex(index: number): BenchmarkSplit {
  if (index < 12) return "development";
  if (index < 16) return "calibration";
  return "blind";
}

function shuffledCaseIds(): readonly string[] {
  const ids = Array.from(
    { length: CASE_COUNT },
    (_, index) => `case-${String(index + 1).padStart(4, "0")}`,
  );
  let state = SPLIT_SEED;
  for (let index = ids.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const swap = state % (index + 1);
    const current = ids[index];
    const other = ids[swap];
    /* v8 ignore next -- generated indexes are in-bounds */
    if (current === undefined || other === undefined) continue;
    ids[index] = other;
    ids[swap] = current;
  }
  return ids;
}

function splitMap(): ReadonlyMap<string, BenchmarkSplit> {
  return new Map(shuffledCaseIds().map((caseId, index) => [caseId, splitForIndex(index)] as const));
}

function expectedFacts(caseIndex: number, outcome: BenchmarkOutcome): Record<string, JsonValue> {
  return {
    "synthetic.case_index": caseIndex,
    "synthetic.marker": outcome === "PASS" || outcome === "FAIL",
    "synthetic.review_required": outcome === "REVIEW",
    "synthetic.applicable": outcome !== "NOT_APPLICABLE",
  };
}

function caseFor(
  index: number,
  splits: ReadonlyMap<string, BenchmarkSplit>,
): SyntheticBenchmarkCase {
  const caseId = `case-${String(index).padStart(4, "0")}`;
  const outcome = OUTCOMES[(index - 1) % OUTCOMES.length] as BenchmarkOutcome;
  const facts = expectedFacts(index, outcome);
  const split = splits.get(caseId);
  if (split === undefined) throw new Error(`Missing synthetic split for ${caseId}`);
  return {
    caseId,
    split,
    expectedOutcome: outcome,
    expectedFacts: facts,
    documents: [
      document(
        uuid(70_000 + index * 10 + 1),
        caseId,
        "PDF",
        "application/pdf",
        pdfBody(caseId, outcome),
      ),
      document(
        uuid(70_000 + index * 10 + 2),
        caseId,
        "IMAGE",
        "image/svg+xml",
        imageBody(caseId, outcome),
      ),
      document(
        uuid(70_000 + index * 10 + 3),
        caseId,
        "JSON",
        "application/json",
        jsonBody(caseId, outcome, facts),
      ),
    ],
    validationScope: "TECHNICAL_DEMO",
  };
}

export function generateSyntheticCorpus(): SyntheticBenchmarkCorpus {
  const splits = splitMap();
  const cases = Array.from({ length: CASE_COUNT }, (_, index) => caseFor(index + 1, splits));
  const hashInput = {
    schemaVersion: SYNTHETIC_BENCHMARK_SCHEMA_VERSION,
    seed: SPLIT_SEED,
    cases,
    validationScope: "TECHNICAL_DEMO",
  };
  return SyntheticBenchmarkCorpusSchema.parse({
    ...hashInput,
    corpusHash: sha256CanonicalJson(hashInput),
  });
}
