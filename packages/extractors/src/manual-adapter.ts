import { FactSchema } from "@vera/contracts";
import type {
  Evidence,
  EvidenceObservation,
  ExtractionFact,
  ExtractionInput,
  ExtractionRequest,
  ExtractionResult,
  ExtractorRun,
  FactCandidate,
  FactObservation,
} from "@vera/contracts";

import {
  createLocalExtractorRun,
  defaultExtractorRuntime,
  parseExtractionRequest,
  parseExtractionResult,
  parseRuntimeTimestamp,
  requireAdapterIdentity,
  requireInputKind,
  type ExtractorAdapter,
  type ExtractorRuntime,
} from "./adapter.js";

interface MaterializedObservation {
  readonly fact: ExtractionFact;
  readonly evidence: readonly Evidence[];
}

type DocumentExtractionRequest = ExtractionRequest & {
  readonly input: Extract<ExtractionInput, { readonly documentId: string }>;
};

function materializeEvidence(
  observation: EvidenceObservation,
  request: DocumentExtractionRequest,
  run: ExtractorRun,
  runtime: ExtractorRuntime,
): Evidence {
  return {
    id: runtime.createId(),
    documentId: request.input.documentId,
    documentHash: request.input.documentHash,
    page: request.input.page,
    text: observation.text,
    language: request.input.language,
    boundingBox: observation.boundingBox,
    providerRunId: run.id,
    capturedAt: run.startedAt,
    validationScope: request.validationScope,
  };
}

function materializeObservation(
  observation: FactObservation,
  request: DocumentExtractionRequest,
  run: ExtractorRun,
  runtime: ExtractorRuntime,
): MaterializedObservation {
  const topEvidence = observation.evidence.map((item) =>
    materializeEvidence(item, request, run, runtime),
  );
  const candidateEvidence: Evidence[] = [];
  const candidates: FactCandidate[] = observation.candidates.map((candidate) => {
    const evidence = candidate.evidence.map((item) =>
      materializeEvidence(item, request, run, runtime),
    );
    candidateEvidence.push(...evidence);
    return {
      id: runtime.createId(),
      originalValue: candidate.originalValue,
      normalizedValue: candidate.normalizedValue,
      evidenceIds: evidence.map(({ id }) => id),
      providerRunId: run.id,
      rawConfidence: candidate.rawConfidence,
    };
  });
  const evidence = [...topEvidence, ...candidateEvidence];
  const common = {
    id: runtime.createId(),
    key: observation.key,
    valueType: observation.valueType,
    providerRunId: run.id,
    observedAt: run.startedAt,
    rawConfidence: observation.rawConfidence,
    validationScope: request.validationScope,
  };

  if (observation.status === "RESOLVED") {
    return {
      fact: FactSchema.parse({
        ...common,
        status: "RESOLVED",
        originalValue: observation.originalValue,
        normalizedValue: observation.normalizedValue,
        evidenceIds: topEvidence.map(({ id }) => id),
        candidates: [],
      }),
      evidence,
    };
  }
  if (observation.status === "CONFLICT") {
    return {
      fact: FactSchema.parse({
        ...common,
        status: "CONFLICT",
        originalValue: null,
        normalizedValue: null,
        evidenceIds: evidence.map(({ id }) => id),
        candidates,
      }),
      evidence,
    };
  }

  return {
    fact: FactSchema.parse({
      ...common,
      status: observation.status,
      originalValue: null,
      normalizedValue: null,
      evidenceIds: topEvidence.map(({ id }) => id),
      candidates: [],
    }),
    evidence,
  };
}

export function materializeFactObservations(
  observations: readonly FactObservation[],
  request: DocumentExtractionRequest,
  run: ExtractorRun,
  runtime: ExtractorRuntime,
): { readonly facts: readonly ExtractionFact[]; readonly evidence: readonly Evidence[] } {
  const materialized = observations.map((observation) =>
    materializeObservation(observation, request, run, runtime),
  );
  return {
    facts: materialized.map(({ fact }) => fact),
    evidence: materialized.flatMap(({ evidence }) => evidence),
  };
}

export class ManualExtractorAdapter implements ExtractorAdapter {
  public readonly id: string;
  public readonly kind = "MANUAL" as const;
  readonly #runtime: ExtractorRuntime;

  public constructor(options: { readonly id?: string; readonly runtime?: ExtractorRuntime } = {}) {
    this.id = options.id ?? "manual.local";
    this.#runtime = options.runtime ?? defaultExtractorRuntime;
  }

  public supports(kind: ExtractionRequest["kind"]): boolean {
    return kind === this.kind;
  }

  public async extract(value: ExtractionRequest): Promise<ExtractionResult> {
    await Promise.resolve();
    const request = parseExtractionRequest(value);
    requireInputKind(request, this.kind);
    requireAdapterIdentity(request, this.id);

    const startedAt = parseRuntimeTimestamp(this.#runtime.now());
    const runContext = createLocalExtractorRun(request, this.#runtime, startedAt, startedAt);
    const { facts, evidence } = materializeFactObservations(
      request.input.observations,
      request,
      runContext,
      this.#runtime,
    );
    const completedAt = parseRuntimeTimestamp(this.#runtime.now());
    const run = { ...runContext, completedAt };

    return parseExtractionResult({
      requestId: request.id,
      run,
      facts,
      evidence,
      embeddings: [],
      validationScope: request.validationScope,
    });
  }
}
