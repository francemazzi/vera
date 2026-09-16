import { currentControlChecks } from "./current-control-checks.js";
import { pinnedCitationsForControl } from "./pinned-source-citations.js";
import { sha256CanonicalJson } from "@vera/contracts";
import {
  normalizeLabelingTopic,
  type PrivateLabelRagIndex,
  type PrivateLabelRagQuery,
  type PrivateLabelRagRetrievedChunk,
} from "@vera/rag";

import type { PreliminaryTemplate, RegulatoryScope, RunnerSourceCitation } from "./contracts.js";

export type LabelControlSourceContext = Readonly<{
  fieldCode: string;
  citations: readonly RunnerSourceCitation[];
  byCategory?: Readonly<Record<string, readonly RunnerSourceCitation[]>>;
}>;

export type LabelRetrievedSources = Readonly<{
  controls: readonly LabelControlSourceContext[];
  /** Frozen before the image is sent to the model and persisted with the run. */
  sourceSnapshot: string;
  byMarket?: readonly Readonly<{
    countryCode: string;
    controls: readonly LabelControlSourceContext[];
  }>[];
}>;

export interface LabelSourceRetriever {
  retrieve(input: {
    /** Backend-issued tenant boundary; never browser-controlled RAG metadata. */
    readonly workspaceId: string;
    readonly scope: RegulatoryScope;
    readonly productCategory: string;
    readonly additionalCategories?: readonly string[];
    readonly template: PreliminaryTemplate;
  }): Promise<LabelRetrievedSources>;
}

function citation(chunk: PrivateLabelRagRetrievedChunk): RunnerSourceCitation {
  const quote = chunk.citation.quote.trim().slice(0, 1_000);
  const pageNumber = chunk.citation.pageNumber;
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
    pageNumber: pageNumber !== null && pageNumber >= 1 ? pageNumber : null,
    quote,
    provenance: "RETRIEVED",
  };
}

function distinctCitations(
  chunks: readonly PrivateLabelRagRetrievedChunk[],
): readonly RunnerSourceCitation[] {
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

type ControlRetrievalQuery = Readonly<{
  queryText: string;
  workspaceId: string;
  jurisdictions: readonly string[];
  evaluationDate: string;
  language: string;
  productCategory: string;
  labelingTopics?: readonly string[];
}>;

/**
 * Topic filters are best-effort. Product category is never dropped: generic
 * prepacked sources are the explicit fallback for category-specific products.
 */
async function retrieveControlChunks(
  ragIndex: Pick<PrivateLabelRagIndex, "retrievePreliminarySafely">,
  query: ControlRetrievalQuery,
): Promise<readonly PrivateLabelRagRetrievedChunk[]> {
  const scoped = {
    queryText: query.queryText,
    workspaceId: query.workspaceId,
    jurisdictions: [...query.jurisdictions],
    evaluationDate: query.evaluationDate,
    language: query.language,
    topK: 3,
  };
  const attempts: PrivateLabelRagQuery[] = [
    {
      ...scoped,
      productCategory: query.productCategory,
      ...(query.labelingTopics && query.labelingTopics.length > 0
        ? { labelingTopics: [...query.labelingTopics] }
        : {}),
    },
    {
      ...scoped,
      productCategory: "generic-prepacked",
      ...(query.labelingTopics?.length ? { labelingTopics: [...query.labelingTopics] } : {}),
    },
  ];
  const chunks: PrivateLabelRagRetrievedChunk[] = [];
  for (const attempt of attempts.filter(
    (value, index) =>
      attempts.findIndex((other) => JSON.stringify(other) === JSON.stringify(value)) === index,
  )) {
    const result = await ragIndex.retrievePreliminarySafely(attempt);
    if (result.status === "AVAILABLE") chunks.push(...result.chunks);
  }
  return chunks;
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
      const markets = input.scope.marketScopes;
      if (markets && markets.length > 0) {
        const byMarket: Array<{
          countryCode: string;
          controls: readonly LabelControlSourceContext[];
        }> = [];
        for (const market of markets) {
          const { marketScopes: _markets, ...base } = input.scope;
          const retrieved = await this.retrieve({ ...input, scope: { ...base, ...market } });
          byMarket.push({ countryCode: market.countryCode, controls: retrieved.controls });
        }
        const controls = input.template.controls.map(({ fieldCode }) => ({
          fieldCode,
          citations: [
            ...new Map(
              byMarket
                .flatMap(
                  (market) =>
                    market.controls.find((control) => control.fieldCode === fieldCode)?.citations ??
                    [],
                )
                .map((entry) => [entry.chunkId, entry]),
            ).values(),
          ],
        }));
        return {
          controls,
          byMarket,
          sourceSnapshot: sha256CanonicalJson({
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
          }),
        };
      }
      const controls = await Promise.all(
        input.template.controls.map(async (control): Promise<LabelControlSourceContext> => {
          const labelingTopics = [
            ...new Set(
              control.topics.map((topic) => normalizeLabelingTopic(topic)).filter(Boolean),
            ),
          ];
          const categories = [
            ...new Set([...(input.additionalCategories ?? []), input.productCategory]),
          ];
          const byCategory: Record<string, readonly RunnerSourceCitation[]> = {};
          for (const productCategory of categories)
            byCategory[productCategory] = distinctCitations(
              await retrieveControlChunks(options.ragIndex, {
                queryText: [
                  control.fieldCode,
                  ...control.topics,
                  control.instruction,
                  ...(input.template.version === "3"
                    ? [
                        currentControlChecks(productCategory, input.scope.countryCode)[
                          control.fieldCode
                        ],
                      ]
                    : []),
                ]
                  .filter(Boolean)
                  .join(" — "),
                workspaceId: input.workspaceId,
                jurisdictions: input.scope.jurisdictions,
                evaluationDate: input.scope.evaluationDate,
                language: officialRetrievalLanguage(input.scope),
                productCategory,
                ...(labelingTopics.length > 0 ? { labelingTopics } : {}),
              }),
            );
          const retrieved = [
            ...new Map(
              Object.values(byCategory)
                .flat()
                .map((entry) => [entry.chunkId, entry]),
            ).values(),
          ];
          const pinned = pinnedCitationsForControl({
            fieldCode: control.fieldCode,
            ...(input.scope.countryCode !== undefined
              ? { countryCode: input.scope.countryCode }
              : {}),
          });
          const seen = new Set<string>();
          const citations = [...retrieved, ...pinned].filter((item) => {
            if (seen.has(item.chunkId)) return false;
            seen.add(item.chunkId);
            return true;
          });
          return {
            fieldCode: control.fieldCode,
            citations,
            ...(categories.length > 1 ? { byCategory } : {}),
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

/**
 * Extra-EU official texts are indexed in the jurisdiction language. Consultant
 * report language (often Italian for a US market) must not empty the Chroma filter.
 */
function officialRetrievalLanguage(scope: RegulatoryScope): string {
  if (scope.jurisdictions.includes("EU")) return scope.language;
  if (scope.countryCode === "US") return "en";
  return scope.language;
}
