import {
  generateSyntheticCorpus,
  runSimulatedProvider,
  runSyntheticBenchmark,
} from "@vera/benchmark";
import type {
  BenchmarkMetricReport,
  BenchmarkOutcome,
  BenchmarkPrediction,
  BenchmarkSplit,
  SyntheticBenchmarkCase,
  SyntheticBenchmarkCorpus,
  SyntheticDocument,
} from "@vera/benchmark";
import {
  applyCalibration,
  fitCalibrationProfile,
  observationsFromBenchmark,
} from "@vera/calibration";
import {
  DSL_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  RULE_TESTING_SCHEMA_VERSION,
  RuleDefinitionSchema,
  RulePackVersionSchema,
  RuleTestFixtureSchema,
  computeRuleDefinitionHash,
  computeRulePackVersionHash,
  computeRuleTestFixtureHash,
  sha256CanonicalJson,
} from "@vera/contracts";
import type {
  AuditAgent,
  EvaluationAuditExport,
  EvaluationOutcome,
  EvidenceObservation,
  ExtractionRequest,
  ExtractionResult,
  FactObservation,
  JsonValue,
  RuleDefinition,
  RuleDefinitionHashInput,
  RulePackEvaluationSnapshot,
  RulePackVersion,
  RulePackVersionHashInput,
  RuleTestCoverageTag,
  RuleTestExpectedFinding,
  RuleTestFixture,
  RuleTestFixtureHashInput,
} from "@vera/contracts";
import { ManualExtractorAdapter } from "@vera/extractors";
import type { ExtractorRuntime } from "@vera/extractors";
import {
  InMemoryEvaluationAuditLedger,
  buildEvaluationRun,
  buildReviewDecision,
  evaluateRulePackVersion,
  replayEvaluationAuditExport,
} from "@vera/rules-core";
import { DEFAULT_REQUIRED_COVERAGE_TAGS, runRulePackTests } from "@vera/rules-testing";

import { DEMO_MVP_SCHEMA_VERSION, DemoMvpReportSchema } from "./schema.js";
import type { DemoMvpReport, DemoMvpReportHashInput, DemoOutcomeCounts } from "./schema.js";

const GENERATED_AT = "2026-07-15T12:00:00.000Z";
const REVIEWED_AT = "2026-07-15T12:10:00.000Z";
const EXPORTED_AT = "2026-07-15T12:20:00.000Z";
const VALID_FROM = "2026-01-01T00:00:00.000Z";
const VALID_TO = "2027-01-01T00:00:00.000Z";
const DOMAIN = "synthetic-quality";
const JURISDICTION = "GLOBAL-DEMO";
const ADAPTER_ID = "manual.demo-mvp";
const DISCLAIMER =
  "Synthetic technical demonstration only; not real-world accuracy, certification or professional validation." as const;

const IDS = {
  source: "00000000-0000-4000-8000-000000015001",
  sourceVersion: "00000000-0000-4000-8000-000000015002",
  ruleCard: "00000000-0000-4000-8000-000000015003",
  ruleCardRevision: "00000000-0000-4000-8000-000000015004",
  pack: "00000000-0000-4000-8000-000000015005",
  version: "00000000-0000-4000-8000-000000015006",
  rule: "00000000-0000-4000-8000-000000015007",
  author: "00000000-0000-4000-8000-000000015008",
  publisher: "00000000-0000-4000-8000-000000015009",
  reviewer: "00000000-0000-4000-8000-000000015010",
  systemActor: "00000000-0000-4000-8000-000000015011",
  calibrationProfile: "00000000-0000-4000-8000-000000015012",
  ruleTestRequest: "00000000-0000-4000-8000-000000015013",
} as const;

export interface DemoCaseRun {
  readonly caseId: string;
  readonly split: BenchmarkSplit;
  readonly expectedOutcome: BenchmarkOutcome;
  readonly extraction: ExtractionResult;
  readonly evaluation: RulePackEvaluationSnapshot;
  readonly auditExport: EvaluationAuditExport;
}

export interface DemoMvpRun {
  readonly corpus: SyntheticBenchmarkCorpus;
  readonly rulePackVersion: RulePackVersion;
  readonly cases: readonly DemoCaseRun[];
  readonly benchmark: BenchmarkMetricReport;
  readonly report: DemoMvpReport;
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function outcomeCounts(): DemoOutcomeCounts {
  return { PASS: 0, FAIL: 0, REVIEW: 0, NOT_APPLICABLE: 0 };
}

function incrementOutcome(counts: DemoOutcomeCounts, outcome: EvaluationOutcome): void {
  counts[outcome] += 1;
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function deterministicRuntime(): ExtractorRuntime {
  let nextId = 160_000;
  return {
    createId() {
      nextId += 1;
      return uuid(nextId);
    },
    now() {
      return GENERATED_AT;
    },
    runtimeVersion: "demo-mvp-1.0.0",
  };
}

function sourceContentHash(): string {
  return sha256CanonicalJson({
    id: IDS.source,
    versionId: IDS.sourceVersion,
    title: "Synthetic demo source for VERA MVP",
    section: "demo-section-1",
    validationScope: "TECHNICAL_DEMO",
  });
}

function makeRule(): RuleDefinition {
  const sourceHash = sourceContentHash();
  const input: RuleDefinitionHashInput = {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: IDS.rule,
    sourceId: IDS.source,
    sourceVersionId: IDS.sourceVersion,
    sourceContentHash: sourceHash,
    ruleCardId: IDS.ruleCard,
    ruleCardRevisionId: IDS.ruleCardRevision,
    ruleCardRevisionContentHash: sha256CanonicalJson({
      id: IDS.ruleCardRevision,
      sourceHash,
      validationScope: "TECHNICAL_DEMO",
    }),
    normativeKey: "synthetic.demo.marker_required",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: { validFrom: VALID_FROM, validTo: VALID_TO },
    appliesWhen: { op: "present", factKey: "synthetic.applicable" },
    satisfiedWhen: { op: "present", factKey: "synthetic.marker" },
    exceptions: [],
    overrides: [],
    conflictsWith: [],
    evidenceBindings: [
      { factKey: "synthetic.applicable", evidenceRequirementKeys: ["applicability"] },
      { factKey: "synthetic.marker", evidenceRequirementKeys: ["marker"] },
    ],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleDefinitionSchema.parse({ ...input, contentHash: computeRuleDefinitionHash(input) });
}

function makeRulePackVersion(): RulePackVersion {
  const rule = makeRule();
  const input: RulePackVersionHashInput = {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: IDS.version,
    packId: IDS.pack,
    semver: "1.0.0",
    domain: DOMAIN,
    jurisdiction: JURISDICTION,
    validity: { validFrom: VALID_FROM, validTo: VALID_TO },
    rules: [rule],
    changeReason: "Synthetic end-to-end MVP demonstration",
    supersedesVersionId: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    createdBy: IDS.author,
    publishedAt: "2026-01-03T00:00:00.000Z",
    publishedBy: IDS.publisher,
    validationScope: "TECHNICAL_DEMO",
  };
  return RulePackVersionSchema.parse({
    ...input,
    contentHash: computeRulePackVersionHash(input),
  });
}

function evidence(text: string): EvidenceObservation {
  return {
    text,
    boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.12 },
  };
}

function factObservation(
  key: "synthetic.applicable" | "synthetic.marker",
  status: "RESOLVED" | "NOT_FOUND" | "NULL",
  text: string,
): FactObservation {
  if (status === "RESOLVED") {
    return {
      key,
      valueType: "BOOLEAN",
      status,
      originalValue: true,
      normalizedValue: true,
      rawConfidence: null,
      evidence: [evidence(text)],
      candidates: [],
    };
  }
  return {
    key,
    valueType: "BOOLEAN",
    status,
    originalValue: null,
    normalizedValue: null,
    rawConfidence: null,
    evidence: [evidence(text)],
    candidates: [],
  };
}

function observationsForCase(item: SyntheticBenchmarkCase): readonly FactObservation[] {
  const appliesStatus = item.expectedOutcome === "NOT_APPLICABLE" ? "NOT_FOUND" : "RESOLVED";
  const markerStatus =
    item.expectedOutcome === "PASS"
      ? "RESOLVED"
      : item.expectedOutcome === "REVIEW"
        ? "NULL"
        : "NOT_FOUND";
  return [
    factObservation(
      "synthetic.applicable",
      appliesStatus,
      `Synthetic applicability evidence for ${item.caseId}: ${appliesStatus}.`,
    ),
    factObservation(
      "synthetic.marker",
      markerStatus,
      `Synthetic marker evidence for ${item.caseId}: ${markerStatus}.`,
    ),
  ];
}

function primaryDocument(item: SyntheticBenchmarkCase): SyntheticDocument {
  const document = item.documents.find(({ kind }) => kind === "PDF");
  if (document === undefined) {
    throw new Error(`Synthetic case ${item.caseId} is missing its PDF document`);
  }
  return document;
}

async function extractCase(
  item: SyntheticBenchmarkCase,
  index: number,
  adapter: ManualExtractorAdapter,
): Promise<ExtractionResult> {
  const document = primaryDocument(item);
  const input: ExtractionRequest["input"] = {
    kind: "MANUAL",
    documentId: document.id,
    documentHash: document.sha256,
    page: 1,
    language: "en",
    observations: [...observationsForCase(item)],
  };
  const request: ExtractionRequest = {
    id: uuid(170_000 + index),
    adapterId: adapter.id,
    kind: "MANUAL",
    inputHash: document.sha256,
    requestedAt: GENERATED_AT,
    input,
    validationScope: "TECHNICAL_DEMO",
  };
  return adapter.extract(request);
}

function expectedFinding(
  rule: RuleDefinition,
  outcome: EvaluationOutcome,
): RuleTestExpectedFinding {
  return {
    ruleId: rule.id,
    ruleContentHash: rule.contentHash,
    outcome,
    effectiveOutcome: outcome,
    resolution: "UNCHANGED",
    relatedRuleIds: [],
  };
}

function coverageTags(outcome: EvaluationOutcome): readonly RuleTestCoverageTag[] {
  const outcomeTag = `OUTCOME_${outcome}` as RuleTestCoverageTag;
  return outcome === "PASS" ? ["EVIDENCE", outcomeTag] : [outcomeTag];
}

function fixtureFromCase(rule: RuleDefinition, item: DemoCaseRun, index: number): RuleTestFixture {
  const outcome = item.evaluation.evaluationResult.aggregateOutcome;
  const input: RuleTestFixtureHashInput = {
    schemaVersion: RULE_TESTING_SCHEMA_VERSION,
    id: uuid(180_000 + index),
    caseId: item.caseId,
    description: `Synthetic MVP fixture for ${outcome}`,
    ruleId: rule.id,
    ruleContentHash: rule.contentHash,
    evaluationDate: GENERATED_AT,
    facts: item.extraction.facts,
    evidence: item.extraction.evidence,
    expected: expectedFinding(rule, outcome),
    coverageTags: coverageTags(outcome),
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleTestFixtureSchema.parse({
    ...input,
    contentHash: computeRuleTestFixtureHash(input),
  });
}

function fixturesFromCases(
  rule: RuleDefinition,
  cases: readonly DemoCaseRun[],
): readonly RuleTestFixture[] {
  const selected = new Map<EvaluationOutcome, DemoCaseRun>();
  for (const item of cases) {
    const outcome = item.evaluation.evaluationResult.aggregateOutcome;
    if (!selected.has(outcome)) selected.set(outcome, item);
  }
  const fixtures = (["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"] as const).map((outcome, index) => {
    const item = selected.get(outcome);
    if (item === undefined) throw new Error(`Missing demo case for ${outcome}`);
    return fixtureFromCase(rule, item, index + 1);
  });
  return fixtures.sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function splitCounts(corpus: SyntheticBenchmarkCorpus): Record<BenchmarkSplit, number> {
  return {
    development: corpus.cases.filter(({ split }) => split === "development").length,
    calibration: corpus.cases.filter(({ split }) => split === "calibration").length,
    blind: corpus.cases.filter(({ split }) => split === "blind").length,
  };
}

function documentCounts(corpus: SyntheticBenchmarkCorpus): {
  readonly documentCount: number;
  readonly pdfCount: number;
  readonly imageCount: number;
  readonly jsonCount: number;
} {
  const documents = corpus.cases.flatMap(({ documents: caseDocuments }) => caseDocuments);
  return {
    documentCount: documents.length,
    pdfCount: documents.filter(({ kind }) => kind === "PDF").length,
    imageCount: documents.filter(({ kind }) => kind === "IMAGE").length,
    jsonCount: documents.filter(({ kind }) => kind === "JSON").length,
  };
}

function latencySummary(predictions: readonly BenchmarkPrediction[]): {
  readonly min: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
} {
  const values = predictions.map(({ latencyMs }) => latencyMs).sort((left, right) => left - right);
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("Cannot summarize latency without predictions");
  }
  const p95Index = Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1);
  return {
    min: first,
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    p95: values[p95Index] ?? last,
    max: last,
  };
}

function buildTuningCycles(corpus: SyntheticBenchmarkCorpus): DemoMvpReportHashInput["tuning"] {
  const developmentCaseIds = sortedStrings(
    corpus.cases.filter(({ split }) => split === "development").map(({ caseId }) => caseId),
  );
  const cycles = [
    {
      cycle: 1,
      splitUsed: "development" as const,
      caseIds: [...developmentCaseIds],
      purpose: "Check that the synthetic extraction prompt contract returns schema-shaped facts.",
      decision: "Kept the deterministic demo extraction contract unchanged.",
      changeHash: sha256CanonicalJson({
        cycle: 1,
        developmentCaseIds,
        decision: "no-corpus-or-blind-change",
      }),
    },
    {
      cycle: 2,
      splitUsed: "development" as const,
      caseIds: [...developmentCaseIds],
      purpose: "Dry-run the review threshold policy without observing calibration or blind labels.",
      decision: "Kept high-risk automatic PASS disabled and routed uncertain results to REVIEW.",
      changeHash: sha256CanonicalJson({
        cycle: 2,
        developmentCaseIds,
        decision: "review-threshold-only",
      }),
    },
  ];
  return { maxCyclesAllowed: 2, cycles, blindSetImmutable: true };
}

function auditAgent(): AuditAgent {
  return {
    id: "demo.system",
    actorId: IDS.systemActor,
    kind: "SYSTEM",
    role: "ADMIN",
    displayName: "Synthetic demo evaluator",
    validationScope: "TECHNICAL_DEMO",
  };
}

function buildAuditExport(input: {
  readonly item: SyntheticBenchmarkCase;
  readonly extraction: ExtractionResult;
  readonly evaluation: RulePackEvaluationSnapshot;
  readonly rule: RuleDefinition;
}): EvaluationAuditExport {
  const ledger = new InMemoryEvaluationAuditLedger();
  const run = buildEvaluationRun({
    id: uuid(190_000 + Number(input.item.caseId.slice(-4))),
    caseId: input.item.caseId,
    recordedAt: GENERATED_AT,
    evaluationSnapshot: input.evaluation,
    input: json({
      caseId: input.item.caseId,
      documents: input.item.documents,
      validationScope: "TECHNICAL_DEMO",
    }),
    facts: json(input.extraction.facts),
    evidence: json(input.extraction.evidence),
    prompt: json({
      kind: "manual-demo-review",
      validationScope: "TECHNICAL_DEMO",
    }),
    provider: json({
      adapterId: input.extraction.run.adapterId,
      runId: input.extraction.run.id,
      rawOutputHash: sha256CanonicalJson(input.extraction.run.rawOutput ?? ""),
      validationScope: "TECHNICAL_DEMO",
    }),
    agent: auditAgent(),
  });
  const storedRun = ledger.recordRun(run);
  const decision = buildReviewDecision({
    id: uuid(200_000 + Number(input.item.caseId.slice(-4))),
    run: storedRun,
    previousDecision: null,
    decision: "CONFIRM",
    findingRuleId: input.rule.id,
    targetOutcome: input.evaluation.evaluationResult.aggregateOutcome,
    reason: "Synthetic technical reviewer confirmed the deterministic finding.",
    decidedAt: REVIEWED_AT,
    actorId: IDS.reviewer,
    exercisedRole: "REVIEWER",
  });
  ledger.appendReviewDecision(decision);
  return ledger.exportRun(storedRun.id, EXPORTED_AT);
}

function auditReplayHash(exports: readonly EvaluationAuditExport[]): string {
  return sha256CanonicalJson(
    exports.map((exported) => {
      const replay = replayEvaluationAuditExport(exported);
      return {
        runHash: replay.run.contentHash,
        snapshotHash: replay.evaluationSnapshot.contentHash,
        decisionHashes: replay.reviewDecisions.map(({ contentHash }) => contentHash),
      };
    }),
  );
}

export async function runDemoMvp(): Promise<DemoMvpRun> {
  const corpus = generateSyntheticCorpus();
  const rulePackVersion = makeRulePackVersion();
  const rule = rulePackVersion.rules[0];
  if (rule === undefined) throw new Error("Synthetic MVP Rule Pack has no rules");

  const adapter = new ManualExtractorAdapter({
    id: ADAPTER_ID,
    runtime: deterministicRuntime(),
  });

  const cases: DemoCaseRun[] = [];
  for (const [index, item] of corpus.cases.entries()) {
    const extraction = await extractCase(item, index + 1, adapter);
    const evaluation = evaluateRulePackVersion(
      rulePackVersion,
      extraction.facts,
      extraction.evidence,
      GENERATED_AT,
    );
    const auditExport = buildAuditExport({ item, extraction, evaluation, rule });
    cases.push({
      caseId: item.caseId,
      split: item.split,
      expectedOutcome: item.expectedOutcome,
      extraction,
      evaluation,
      auditExport,
    });
  }

  const fixtures = fixturesFromCases(rule, cases);
  const ruleTestRun = runRulePackTests({
    schemaVersion: RULE_TESTING_SCHEMA_VERSION,
    requestId: IDS.ruleTestRequest,
    rulePackVersion,
    fixtures,
    requiredCoverageTags: DEFAULT_REQUIRED_COVERAGE_TAGS,
    validationScope: "TECHNICAL_DEMO",
  });

  const benchmark = runSyntheticBenchmark(corpus);
  const simulatedProvider = runSimulatedProvider(corpus);
  const calibrationProfile = fitCalibrationProfile({
    id: IDS.calibrationProfile,
    version: "1.0.0-demo",
    modelName: simulatedProvider.model,
    modelDigest: simulatedProvider.modelDigest,
    targetKind: "FINDING",
    factKey: null,
    corpusHash: corpus.corpusHash,
    observations: observationsFromBenchmark(corpus, simulatedProvider),
    binCount: 5,
    minSamples: 3,
    maxAcceptedRisk: 0.1,
  });
  const calibrationApplication = applyCalibration(calibrationProfile, {
    score: 0.9,
    proposedOutcome: "PASS",
    riskLevel: "HIGH",
  });

  const counts = outcomeCounts();
  let matchedExpectedCases = 0;
  for (const item of cases) {
    const outcome = item.evaluation.evaluationResult.aggregateOutcome;
    incrementOutcome(counts, outcome);
    if (outcome === item.expectedOutcome) matchedExpectedCases += 1;
  }

  const docs = documentCounts(corpus);
  const provider = benchmark.providerRuns[0];
  if (provider === undefined) throw new Error("Synthetic benchmark did not produce a provider run");

  const exports = cases.map(({ auditExport }) => auditExport);
  const split = splitCounts(corpus);
  const reportHashInput: DemoMvpReportHashInput = {
    schemaVersion: DEMO_MVP_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    validationScope: "TECHNICAL_DEMO",
    corpus: {
      seed: corpus.seed,
      corpusHash: corpus.corpusHash,
      caseCount: corpus.cases.length,
      splitCounts: split,
      blindCaseIds: [
        ...sortedStrings(
          corpus.cases
            .filter(({ split: caseSplit }) => caseSplit === "blind")
            .map(({ caseId }) => caseId),
        ),
      ],
    },
    source: {
      sourceId: IDS.source,
      sourceVersionId: IDS.sourceVersion,
      contentHash: sourceContentHash(),
      approvalState: "APPROVED",
    },
    rulePack: {
      versionId: rulePackVersion.id,
      semver: rulePackVersion.semver,
      contentHash: rulePackVersion.contentHash,
      ruleCount: rulePackVersion.rules.length,
      testRunHash: ruleTestRun.contentHash,
      testGatePassed: ruleTestRun.passed,
    },
    ingestion: {
      caseCount: corpus.cases.length,
      documentCount: docs.documentCount,
      pdfCount: docs.pdfCount,
      imageCount: docs.imageCount,
      jsonCount: docs.jsonCount,
    },
    extraction: {
      adapterId: ADAPTER_ID,
      runCount: cases.length,
      factCount: cases.reduce((total, item) => total + item.extraction.facts.length, 0),
      evidenceCount: cases.reduce((total, item) => total + item.extraction.evidence.length, 0),
      rawOutputHash: sha256CanonicalJson(
        cases.map(({ extraction }) => extraction.run.rawOutput ?? ""),
      ),
    },
    evaluation: {
      evaluatedCases: cases.length,
      matchedExpectedCases,
      outcomeCounts: counts,
      reviewRate: counts.REVIEW / cases.length,
      snapshotHash: sha256CanonicalJson(cases.map(({ evaluation }) => evaluation.contentHash)),
    },
    review: {
      requiredDecisions: cases.length,
      completedDecisions: cases.length,
      overrideCount: 0,
      decisionChainHash: sha256CanonicalJson(
        exports.flatMap(({ reviewDecisions }) =>
          reviewDecisions.map(({ contentHash }) => contentHash),
        ),
      ),
    },
    audit: {
      exportedRuns: exports.length,
      exportHash: sha256CanonicalJson(exports.map(({ exportHash }) => exportHash)),
      replayHash: auditReplayHash(exports),
    },
    benchmark: {
      reportHash: benchmark.reportHash,
      model: provider.model,
      modelDigest: provider.modelDigest,
      runtimeVersion: provider.runtimeVersion,
      extraction: benchmark.extraction,
      findings: benchmark.findings,
      latencyMs: latencySummary(provider.predictions),
    },
    calibration: {
      profileId: calibrationProfile.id,
      profileHash: calibrationProfile.contentHash,
      sampleCount: calibrationProfile.sampleCount,
      threshold: calibrationProfile.threshold,
      demoApplicationDecision: calibrationApplication.decision,
      demoApplicationReason: calibrationApplication.reason,
    },
    tuning: buildTuningCycles(corpus),
    modelCards: [
      {
        model: provider.model,
        digest: provider.modelDigest,
        runtimeVersion: provider.runtimeVersion,
        intendedUse: "Synthetic local transport and pipeline demonstration.",
        limitations: [
          "Metrics are computed on fittizi synthetic cases only.",
          "No professional validation is implied.",
          "Blind split is immutable and used only for final demonstration reporting.",
        ],
        validationScope: "TECHNICAL_DEMO",
      },
    ],
    limitations: [
      "The corpus, source, Rule Pack, facts, evidence and reviews are synthetic.",
      "The benchmark gate checks reproducibility and schema completion, not real-world accuracy.",
      "Automatic PASS remains disabled for high-risk demo calibration candidates.",
    ],
    disclaimer: DISCLAIMER,
  };

  const report = DemoMvpReportSchema.parse({
    ...reportHashInput,
    contentHash: sha256CanonicalJson(reportHashInput),
  });
  return { corpus, rulePackVersion, cases, benchmark, report };
}
