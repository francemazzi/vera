import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  OPENROUTER_LABEL_MODELS,
  PreliminaryTemplateSchema,
  type OpenRouterLabelModel,
  type PreliminaryTemplate,
} from "./contracts.js";
import { LABEL_BENCHMARK_CASES } from "./model-benchmark-cases.js";
import { createOpenRouterLabelEvaluator } from "./openrouter-evaluator.js";

const execFileAsync = promisify(execFile);
const TARGET_AGREEMENT = 0.8;

type TemplateModule = Readonly<{
  EU_IT_EVALUATION_TEMPLATE: unknown;
  GLOBAL_EVALUATION_TEMPLATE: unknown;
}>;
type LabelFieldCode = PreliminaryTemplate["controls"][number]["fieldCode"];
type ImageProcessor = {
  rotate(): ImageProcessor;
  resize(options: Readonly<{
    width: number;
    height: number;
    fit: "inside";
    withoutEnlargement: boolean;
  }>): ImageProcessor;
  png(): ImageProcessor;
  toBuffer(): Promise<Buffer>;
};
type SharpFactory = (input: Uint8Array) => ImageProcessor;

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

function loadTemplates(backendDist: string): Readonly<{
  IT: PreliminaryTemplate;
  GLOBAL: PreliminaryTemplate;
}> {
  const require = createRequire(import.meta.url);
  const modulePath = path.join(backendDist, "application/label/evaluation-templates.js");
  const loaded: unknown = require(modulePath);
  if (typeof loaded !== "object" || loaded === null || Array.isArray(loaded)) {
    throw new Error("Backend evaluation template module is invalid");
  }
  const module = loaded as TemplateModule;
  return {
    IT: readTemplate(module.EU_IT_EVALUATION_TEMPLATE),
    GLOBAL: readTemplate(module.GLOBAL_EVALUATION_TEMPLATE),
  };
}

function loadSharp(backendDist: string): SharpFactory {
  const require = createRequire(path.join(backendDist, "..", "package.json"));
  const loaded: unknown = require("sharp");
  if (typeof loaded !== "function") throw new Error("Backend sharp dependency is unavailable");
  return loaded as SharpFactory;
}

async function renderPdf(file: string): Promise<readonly Buffer[]> {
  const directory = await mkdtemp(path.join(tmpdir(), "silto-model-benchmark-"));
  const input = path.join(directory, "input.pdf");
  const output = path.join(directory, "page");
  try {
    await writeFile(input, await readFile(file));
    await execFileAsync("pdftoppm", ["-png", input, output], {
      maxBuffer: 1024 * 1024,
      timeout: 90_000,
    });
    const names = (await readdir(directory))
      .filter((name) => /^page-\d+\.png$/u.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    if (names.length === 0) throw new Error(`No pages rendered for ${file}`);
    return Promise.all(names.map((name) => readFile(path.join(directory, name))));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function normalizeFile(file: string, sharp: SharpFactory): Promise<readonly Buffer[]> {
  const rawPages =
    path.extname(file).toLowerCase() === ".pdf" ? await renderPdf(file) : [await readFile(file)];
  return Promise.all(
    rawPages.slice(0, 4).map((bytes) =>
      sharp(bytes)
        .rotate()
        .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer(),
    ),
  );
}

async function normalizeCaseFiles(
  datasetRoot: string,
  labelFiles: readonly string[],
  sharp: SharpFactory,
): Promise<readonly Buffer[]> {
  const pages = await Promise.all(
    labelFiles.map((file) => normalizeFile(path.join(datasetRoot, file), sharp)),
  );
  return pages.flat();
}

async function main(): Promise<void> {
  const datasetRoot = requiredArgument(2, "Dataset root");
  const backendDist = requiredArgument(3, "Backend dist");
  const model = readModel();
  const apiKey = process.env["OPENROUTER_API_KEY"]?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY must be configured");
  const templates = loadTemplates(backendDist);
  const sharp = loadSharp(backendDist);
  let matched = 0;
  let compared = 0;
  let estimatedCostUsd = 0;

  for (const benchmarkCase of LABEL_BENCHMARK_CASES) {
    const template = templates[benchmarkCase.template];
    const pages = await normalizeCaseFiles(datasetRoot, benchmarkCase.labelFiles, sharp);
    const evaluator = createOpenRouterLabelEvaluator({
      apiKey,
      model,
      promptVersion: "label-evaluation-v4",
      rulePackVersion:
        benchmarkCase.template === "IT"
          ? "eu-it-preliminary-v1@2"
          : "global-food-label-preliminary-v1@2",
      timeoutMs: 240_000,
    });
    const result = await evaluator.evaluate({
      pages: pages.map((bytes, index) => ({ page: index + 1, bytes })),
      countryCodes: [benchmarkCase.countryCode],
      productCategory: benchmarkCase.productCategory,
      regulatoryScope: {
        countryCode: benchmarkCase.countryCode,
        regulatoryAreas: [benchmarkCase.regulatoryArea],
        jurisdictions: [benchmarkCase.countryCode],
        language: benchmarkCase.language,
        evaluationDate: "2026-09-01T00:00:00.000Z",
      },
      sources: {
        controls: template.controls.map(({ fieldCode }) => ({ fieldCode, citations: [] })),
        sourceSnapshot: template.sourceSnapshot,
      },
      template,
      goldExamples: [],
    });
    const predicted = new Map(
      result.controls.map((control) => [control.fieldCode, control.consultantStatus]),
    );
    const expected = Object.entries(benchmarkCase.expected) as readonly [
      LabelFieldCode,
      string,
    ][];
    const mismatches = expected
      .filter(([fieldCode, status]) => predicted.get(fieldCode) !== status)
      .map(([fieldCode, status]) => ({
        fieldCode,
        expected: status,
        predicted: predicted.get(fieldCode) ?? null,
      }));
    const caseMatched = expected.length - mismatches.length;
    matched += caseMatched;
    compared += expected.length;
    estimatedCostUsd += result.usage?.estimatedCostUsd ?? 0;
    process.stdout.write(
      `${JSON.stringify({
        case: benchmarkCase.name,
        reportPath: benchmarkCase.reportPath,
        matched: caseMatched,
        compared: expected.length,
        agreement: caseMatched / expected.length,
        mismatches,
      })}\n`,
    );
  }

  const agreement = compared > 0 ? matched / compared : 0;
  process.stdout.write(
    `${JSON.stringify({
      summary: {
        model,
        promptVersion: "label-evaluation-v4",
        matched,
        compared,
        agreement,
        targetAgreement: TARGET_AGREEMENT,
        targetReached: agreement >= TARGET_AGREEMENT,
        estimatedCostUsd,
      },
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Benchmark failed"}\n`);
  process.exitCode = 1;
});
