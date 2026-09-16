import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPENROUTER_LABEL_MODELS,
  PreliminaryTemplateSchema,
  type OpenRouterLabelModel,
  type PreliminaryTemplate,
} from "./contracts.js";
import { CIPRIANI_PASTA_GOLD_CASES } from "./cipriani-pasta-gold.js";
import {
  attributeCiprianiMismatch,
  ciprianiReplayMeetsGate,
} from "./cipriani-pasta-mismatch.js";
import { loadCiprianiPastaPages } from "./cipriani-pasta-pages.js";
import { scoreCiprianiPastaCase } from "./cipriani-pasta-score.js";
import { createProductFactExtractor } from "./create-product-fact-extractor.js";
import { createOpenRouterLabelEvaluator } from "./openrouter-evaluator.js";
import { pinnedCitationsForControl } from "./pinned-source-citations.js";

type SharpFactory = Parameters<typeof loadCiprianiPastaPages>[0]["sharp"];

function requiredArgument(index: number, description: string): string {
  const value = process.argv[index]?.trim();
  if (!value) throw new Error(`${description} argument is required`);
  return path.resolve(value);
}

function readModel(): OpenRouterLabelModel {
  const value = process.argv[4]?.trim() || "google/gemini-3.7-flash";
  if (!(OPENROUTER_LABEL_MODELS as readonly string[]).includes(value)) {
    throw new Error(`Model must be one of ${OPENROUTER_LABEL_MODELS.join(", ")}`);
  }
  return value as OpenRouterLabelModel;
}

function readTemplate(value: unknown): PreliminaryTemplate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Backend evaluation template is invalid");
  }
  const source = value as Record<string, unknown>;
  return PreliminaryTemplateSchema.parse({
    id: source["id"],
    version: source["version"],
    promptVersion: source["promptVersion"],
    sourceSnapshot: source["sourceSnapshot"],
    citations: source["citations"],
    sourceArchives: source["sourceArchives"],
    controls: source["controls"],
  });
}

function loadCurrentTemplate(backendDist: string): PreliminaryTemplate {
  const require = createRequire(path.join(backendDist, "..", "package.json"));
  const loaded: unknown = require(path.join(
    backendDist,
    "application/label/current-evaluation-template.js",
  ));
  if (typeof loaded !== "object" || loaded === null || !("currentEvaluationTemplate" in loaded)) {
    throw new Error("currentEvaluationTemplate is unavailable");
  }
  const factory = (loaded as { currentEvaluationTemplate: () => unknown }).currentEvaluationTemplate;
  return readTemplate(factory());
}

function loadSharp(backendDist: string): SharpFactory {
  const require = createRequire(path.join(backendDist, "..", "package.json"));
  const loaded: unknown = require("sharp");
  if (typeof loaded !== "function") throw new Error("Backend sharp dependency is unavailable");
  return loaded as SharpFactory;
}

function replaySources(template: PreliminaryTemplate) {
  return {
    sourceSnapshot: template.sourceSnapshot,
    controls: template.controls.map((control) => ({
      fieldCode: control.fieldCode,
      citations: pinnedCitationsForControl({
        fieldCode: control.fieldCode,
        countryCode: "US",
      }),
    })),
  };
}

async function main(): Promise<void> {
  const datasetRoot = requiredArgument(2, "Dataset root");
  const backendDist = requiredArgument(3, "Backend dist");
  const model = readModel();
  const apiKey = process.env["OPENROUTER_API_KEY"]?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY must be configured");
  const template = loadCurrentTemplate(backendDist);
  const sharp = loadSharp(backendDist);
  const extractor = createProductFactExtractor({ apiKey, model, timeoutMs: 240_000 });
  const evaluator = createOpenRouterLabelEvaluator({
    apiKey,
    model,
    promptVersion: "label-evaluation-v5",
    timeoutMs: 240_000,
  });
  const outputDir = path.resolve(
    process.env["CIPRIANI_REPLAY_DIR"]?.trim() ||
      path.join(fileURLToPath(new URL("../../..", import.meta.url)), ".vera-private/cipriani-pasta-replay"),
  );
  await mkdir(outputDir, { recursive: true });
  const rows: unknown[] = [];
  let matched = 0;
  let compared = 0;
  let blockingHits = 0;
  let blockingTotal = 0;
  let falseEuFailures = 0;
  const selectedIds = (process.env["CIPRIANI_CASE_ID"] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = selectedIds.length
    ? CIPRIANI_PASTA_GOLD_CASES.filter((item) => selectedIds.includes(item.id))
    : CIPRIANI_PASTA_GOLD_CASES;
  if (selected.length === 0) throw new Error("No Cipriani pasta cases selected");
  for (const gold of selected) {
    try {
      const pages = await loadCiprianiPastaPages({ datasetRoot, gold, sharp });
      const extracted = await extractor.extract(
        pages.map((bytes, index) => ({ page: index + 1, bytes })),
      );
      const result = await evaluator.evaluate({
        pages: pages.map((bytes, index) => ({ page: index + 1, bytes })),
        countryCodes: ["US"],
        productCategory: "generic-prepacked",
        productFacts: {
          ...extracted.facts,
          products: extracted.facts.products.map((product, index) =>
            index === 0 ? { ...product, name: gold.productName } : product,
          ),
        },
        regulatoryScope: {
          countryCode: "US",
          regulatoryAreas: ["AMERICAS"],
          jurisdictions: ["US"],
          language: "en",
          evaluationDate: "2026-09-10T00:00:00.000Z",
        },
        sources: replaySources(template),
        template,
        goldExamples: [],
      });
      const predicted = Object.fromEntries(
        result.controls.map((control) => [control.fieldCode, control.consultantStatus ?? "ATTENZIONE"]),
      );
      const score = scoreCiprianiPastaCase({
        gold,
        predicted,
        controls: result.controls.map((control) => ({
          fieldCode: control.fieldCode,
          consultantStatus: control.consultantStatus ?? "ATTENZIONE",
          rationale: control.rationale,
          correctiveSuggestion: control.correctiveSuggestion ?? null,
        })),
      });
      matched += score.matched;
      compared += score.compared;
      blockingHits += score.blockingHits.length;
      blockingTotal += gold.blockingFindings.length;
      falseEuFailures += score.falseEuFailures.length;
      const controls = result.controls.map((control) => ({
        fieldCode: control.fieldCode,
        outcome: control.outcome,
        consultantStatus: control.consultantStatus ?? "ATTENZIONE",
        blockerCode: control.assessment?.blocker?.code ?? null,
        citationChunkIds: control.citations.map((citation) => citation.chunkId),
      }));
      const mismatches = score.mismatches.map((mismatch) => {
        const control = controls.find((item) => item.fieldCode === mismatch.fieldCode);
        return {
          ...mismatch,
          cause: attributeCiprianiMismatch({
            expected: mismatch.expected,
            predicted: mismatch.predicted,
            citationChunkIds: control?.citationChunkIds ?? [],
            ...(control?.outcome !== undefined ? { outcome: control.outcome } : {}),
            ...(control?.blockerCode !== undefined ? { blockerCode: control.blockerCode } : {}),
          }),
        };
      });
      const row = {
        case: gold.id,
        split: gold.split,
        family: gold.family,
        ...score,
        mismatches,
        controls,
        usage: result.usage,
      };
      rows.push(row);
      await writeFile(path.join(outputDir, `${gold.id}.json`), `${JSON.stringify(row, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ case: gold.id, agreement: score.agreement })}\n`);
    } catch (error: unknown) {
      const row = {
        case: gold.id,
        split: gold.split,
        family: gold.family,
        error: error instanceof Error ? error.message : "Cipriani replay case failed",
      };
      rows.push(row);
      await writeFile(path.join(outputDir, `${gold.id}.json`), `${JSON.stringify(row, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify(row)}\n`);
    }
  }
  const calibration = selected.filter((item) => item.split === "calibration");
  const holdout = selected.filter((item) => item.split === "holdout");
  const agreement = compared > 0 ? matched / compared : 0;
  const blockingRecall = blockingTotal > 0 ? blockingHits / blockingTotal : 0;
  const summary = {
    model,
    promptVersion: "label-evaluation-v5",
    matched,
    compared,
    agreement,
    blockingRecall,
    falseEuFailures,
    holdoutCases: holdout.map((item) => item.id),
    calibrationCases: calibration.map((item) => item.id),
    gate: {
      minAgreement: 0.9,
      minBlockingRecall: 0.85,
      passed: ciprianiReplayMeetsGate({
        agreement,
        blockingRecall,
        falseEuFailures,
      }),
    },
    cases: rows,
  };
  await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ summary: { ...summary, cases: rows.length } })}\n`);
  if (!summary.gate.passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Cipriani replay failed"}\n`);
  process.exitCode = 1;
});
