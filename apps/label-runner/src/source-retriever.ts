import { sha256CanonicalJson } from "@vera/contracts";
import { normalizeLabelingTopic, type PrivateLabelRagIndex, type PrivateLabelRagRetrievedChunk } from "@vera/rag";

import type {
  PreliminaryTemplate,
  RegulatoryScope,
  RunnerSourceCitation,
} from "./contracts.js";

export type LabelControlSourceContext = Readonly<{
  fieldCode: string;
  citations: readonly RunnerSourceCitation[];
}>;

export type LabelRetrievedSources = Readonly<{
  controls: readonly LabelControlSourceContext[];
  /** Frozen before the image is sent to the model and persisted with the run. */
  sourceSnapshot: string;
}>;

export interface LabelSourceRetriever {
  retrieve(input: {
    /** Backend-issued tenant boundary; never browser-controlled RAG metadata. */
    readonly workspaceId: string;
    readonly scope: RegulatoryScope;
    readonly productCategory: string;
    readonly template: PreliminaryTemplate;
  }): Promise<LabelRetrievedSources>;
}

function citation(chunk: PrivateLabelRagRetrievedChunk): RunnerSourceCitation {
  return {
    chunkId: chunk.citation.chunkId,
    sourceVersionId: chunk.citation.sourceVersionId,
    sourceContentHash: chunk.citation.sourceContentHash,
    title: chunk.citation.title,
    documentType: chunk.citation.documentType,
    actReference: chunk.citation.actReference,
    canonicalReference: chunk.citation.canonicalReference,
    pdfReference: chunk.citation.pdfReference,
    sectionId: chunk.citation.sectionId,
    sectionTitle: chunk.citation.sectionTitle,
    pageNumber: chunk.citation.pageNumber,
    quote: chunk.citation.quote,
  };
}

function distinctCitations(chunks: readonly PrivateLabelRagRetrievedChunk[]): readonly RunnerSourceCitation[] {
  const seen = new Set<string>();
  return chunks
    .map(citation)
    .filter((value) => {
      if (seen.has(value.chunkId)) return false;
      seen.add(value.chunkId);
      return true;
    })
    .slice(0, 3);
}

/**
 * RAG is queried once per template control. Retrieval failure is deliberately
 * converted into an empty source set: the evaluator then emits REVIEW_REQUIRED
 * rather than making a claim without a verified citation.
 */
export function createChromaLabelSourceRetriever(options: {
  readonly ragIndex: Pick<PrivateLabelRagIndex, "retrievePreliminarySafely">;
}): LabelSourceRetriever {
  return {
    async retrieve(input) {
      const controls = await Promise.all(
        input.template.controls.map(async (control): Promise<LabelControlSourceContext> => {
          const result = await options.ragIndex.retrievePreliminarySafely({
            queryText: [control.fieldCode, ...control.topics, control.instruction]
              .filter(Boolean)
              .join(" — "),
            workspaceId: input.workspaceId,
            jurisdictions: input.scope.jurisdictions,
            evaluationDate: input.scope.evaluationDate,
            language: input.scope.language,
            productCategory: input.productCategory,
            labelingTopics:
              control.topics.length > 0
                ? [...new Set(control.topics.map((topic) => normalizeLabelingTopic(topic)).filter(Boolean))]
                : undefined,
            topK: 3,
          });
          return {
            fieldCode: control.fieldCode,
            citations: result.status === "AVAILABLE" ? distinctCitations(result.chunks) : [],
          };
        }),
      );
      const sourceSnapshot = sha256CanonicalJson({
        workspaceId: input.workspaceId,
        scope: input.scope,
        productCategory: input.productCategory,
        template: { id: input.template.id, version: input.template.version },
        controls: controls.map(({ fieldCode, citations }) => ({
          fieldCode,
          citations: citations.map(({ chunkId, sourceVersionId, sourceContentHash }) => ({
            chunkId,
            sourceVersionId,
            sourceContentHash,
          })),
        })),
      });
      return { controls, sourceSnapshot };
    },
  };
}

export function fallbackRegulatoryScope(input: {
  readonly countryCodes: readonly string[];
  readonly now?: Date;
}): RegulatoryScope {
  const countryCode = input.countryCodes[0] ?? "IT";
  const euCountries = new Set([
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "EL", "HU", "IE",
    "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  ]);
  const isEu = euCountries.has(countryCode);
  return {
    countryCode,
    regulatoryAreas: isEu ? ["EU"] : ["WORLD"],
    jurisdictions: isEu ? ["EU", countryCode] : [countryCode],
    language: countryCode === "IT" ? "it" : "en",
    evaluationDate: (input.now ?? new Date()).toISOString(),
  };
}
