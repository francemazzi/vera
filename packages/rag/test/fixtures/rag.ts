import { sha256CanonicalJson } from "@vera/contracts";

import type {
  EmbeddingProvider,
  RagProviderModel,
  RagRetrievedChunk,
  RagSourceSection,
  RuleDraftProvider,
  RuleDraftProviderResult,
} from "../../src/index.js";
import { citationFromChunk, chunkApprovedSourceSections, RagError } from "../../src/index.js";

export const MODEL: RagProviderModel = {
  name: "synthetic-rag-model",
  digest: "a".repeat(64),
  runtimeVersion: "ollama-simulated",
};

export function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`;
}

export function section(overrides: Partial<RagSourceSection> = {}): RagSourceSection {
  return {
    sourceId: uuid(1),
    sourceVersionId: uuid(2),
    sourceType: "POLICY",
    sourceState: "APPROVED",
    domain: "synthetic-domain",
    jurisdiction: "DEMO",
    title: "Synthetic Source",
    stableReference: "SYN-REF-001",
    versionLabel: "2026.1",
    license: "CC0-1.0",
    sourceContentHash: "b".repeat(64),
    validity: { validFrom: "2026-01-01T00:00:00.000Z", validTo: null },
    sectionId: "section-1",
    sectionTitle: "Synthetic retention rule",
    text: "Synthetic records must retain a visible label for seven days. Evidence must show the label text.",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

export function retrievedChunk(overrides: Partial<RagRetrievedChunk> = {}): RagRetrievedChunk {
  const chunk = chunkApprovedSourceSections([section()])[0];
  if (chunk === undefined) throw new Error("fixture chunk missing");
  return {
    ...chunk,
    score: 0.98,
    citation: citationFromChunk(chunk),
    ...overrides,
  };
}

export class KeywordEmbeddingProvider implements EmbeddingProvider {
  public readonly model = MODEL;

  public embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.resolve(
      texts.map((text) => {
        const normalized = text.toLowerCase();
        if (normalized.includes("retention") || normalized.includes("retain")) return [1, 0, 0, 0];
        if (normalized.includes("label")) return [0.8, 0.2, 0, 0];
        if (normalized.includes("archive")) return [0, 1, 0, 0];
        return [0, 0, 1, 0];
      }),
    );
  }
}

export class FailingEmbeddingProvider implements EmbeddingProvider {
  public readonly model = MODEL;

  public embedTexts(): Promise<readonly (readonly number[])[]> {
    return Promise.reject(
      new RagError("PROVIDER_UNAVAILABLE", "synthetic provider offline", {
        retryable: true,
      }),
    );
  }
}

export class StaticDraftProvider implements RuleDraftProvider {
  public readonly model = MODEL;
  readonly #rawOutput: string;
  readonly #failuresBeforeSuccess: number;
  #calls = 0;

  public constructor(rawOutput: unknown, failuresBeforeSuccess = 0) {
    this.#rawOutput = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
    this.#failuresBeforeSuccess = failuresBeforeSuccess;
  }

  public generateJson(): Promise<RuleDraftProviderResult> {
    this.#calls += 1;
    if (this.#calls <= this.#failuresBeforeSuccess) {
      return Promise.reject(
        new RagError("PROVIDER_UNAVAILABLE", "synthetic draft provider unavailable", {
          retryable: true,
        }),
      );
    }
    return Promise.resolve({
      rawOutput: this.#rawOutput,
      attempts: 1,
      provider: this.model,
    });
  }
}

export function validDraftOutput(chunkId = retrievedChunk().chunkId): unknown {
  return {
    targetState: "DRAFT",
    validationScope: "TECHNICAL_DEMO",
    provenance: "AI_ASSISTED",
    sourceId: uuid(1),
    sourceVersionId: uuid(2),
    sourceSection: "section-1",
    normativeActor: "Synthetic operator",
    object: "Synthetic record label",
    scope: "Synthetic demo records",
    normativeKey: "synthetic.retention.label",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    riskRationale: "Synthetic demonstration only.",
    evidenceRequirements: [
      {
        key: "label.visible",
        description: "Evidence shows the visible label text.",
        rationale: "The cited section requires visible label text.",
        citationChunkIds: [chunkId],
      },
    ],
    exceptions: [],
    citations: [{ chunkId, quote: "Synthetic records must retain a visible label." }],
  };
}

export function contentHash(value: unknown): string {
  return sha256CanonicalJson(value);
}
