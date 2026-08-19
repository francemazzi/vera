export { citationFromChunk, chunkApprovedSourceSections, splitRagText } from "./chunking.js";
export type { ChunkingOptions } from "./chunking.js";
export { RagError } from "./errors.js";
export type { RagErrorCode } from "./errors.js";
export { ChromaHttpVectorStore } from "./chroma-http-client.js";
export type { ChromaHttpVectorStoreOptions } from "./chroma-http-client.js";
export type {
  ChromaCollection,
  ChromaMetadata,
  ChromaMetadataValue,
  ChromaVectorMatch,
  ChromaVectorQuery,
  ChromaVectorRecord,
  ChromaVectorStore,
} from "./chroma-client.js";
export { labelingTopicQueryValues, normalizeLabelingTopic } from "./labeling-topic.js";
export { ChromaPrivateLabelRagIndex } from "./private-label-chroma-index.js";
export type {
  ChromaPrivateLabelRagIndexOptions,
  PrivateLabelRagIndex,
  PrivateLabelRagIndexResult,
} from "./private-label-chroma-index.js";
export {
  OPENROUTER_GEMINI_EMBEDDING_DIMENSIONS,
  OPENROUTER_GEMINI_EMBEDDING_MODEL,
  OPENROUTER_GEMINI_EMBEDDING_ROUTING_CONFIG_HASH,
  OpenRouterEmbeddingProvider,
} from "./openrouter-embedding-provider.js";
export type { OpenRouterEmbeddingProviderOptions } from "./openrouter-embedding-provider.js";
export { PgVectorRagIndex } from "./pgvector-index.js";
export type { PgVectorRagIndexOptions, RagIndexResult } from "./pgvector-index.js";
export { RetryingEmbeddingProvider, RetryingRuleDraftProvider, withRetry } from "./providers.js";
export type {
  EmbeddingProvider,
  PrivateLabelEmbeddingProvider,
  RetryOptions,
  RuleDraftProvider,
  RuleDraftProviderResult,
} from "./providers.js";
export { OllamaEmbeddingProvider, OllamaRuleDraftProvider } from "./ollama-provider.js";
export type { OllamaRagProviderOptions } from "./ollama-provider.js";
export {
  OPENROUTER_RULE_CARD_DRAFT_SCHEMA_HASH,
  OpenRouterRuleDraftProvider,
} from "./openrouter-provider.js";
export type { OpenRouterRagProviderOptions } from "./openrouter-provider.js";
export {
  buildRuleCardDraftPrompt,
  createRuleCardWorkflowAdvancementRequest,
  generateRuleCardDraft,
} from "./authoring.js";
export type { DraftGenerationOptions, DraftPromptInput } from "./authoring.js";
export {
  RetrievalBenchmarkCaseSchema,
  RetrievalMetricsSchema,
  computeRetrievalMetrics,
} from "./metrics.js";
export type { RetrievalBenchmarkCase, RetrievalMetrics } from "./metrics.js";
export {
  DraftCitationReferenceSchema,
  DraftRuleCardEvidenceRequirementSchema,
  DraftRuleCardExceptionSchema,
  OllamaRagProviderModelSchema,
  OpenRouterRagProviderModelSchema,
  RagAvailableResultSchema,
  RagCitationSchema,
  RagChunkSchema,
  RagProviderModelSchema,
  RagProviderUsageSchema,
  RagRetrievalQuerySchema,
  RagRetrievedChunkSchema,
  RagSourceSectionSchema,
  RagUnavailableResultSchema,
  RuleCardDraftGenerationLogSchema,
  RuleCardDraftGenerationResultSchema,
  RuleCardDraftSuggestionSchema,
  RuleCardWorkflowAdvancementRequestSchema,
} from "./types.js";
export type {
  DraftCitationReference,
  DraftRuleCardEvidenceRequirement,
  DraftRuleCardException,
  OllamaRagProviderModel,
  OpenRouterRagProviderModel,
  ParsedRagRetrievalQuery,
  RagAvailableResult,
  RagCitation,
  RagChunk,
  RagProviderModel,
  RagProviderUsage,
  RagRetrievalQuery,
  RagRetrievedChunk,
  RagSafeRetrievalResult,
  RagSourceSection,
  RagUnavailableResult,
  RuleCardDraftGenerationLog,
  RuleCardDraftGenerationResult,
  RuleCardDraftSuggestion,
  RuleCardWorkflowAdvancementRequest,
} from "./types.js";
export {
  PRIVATE_LABEL_APPROVED_COLLECTION,
  PRIVATE_LABEL_SHARED_CATALOG_WORKSPACE_SCOPE,
  PRIVATE_LABEL_VERIFIED_COLLECTION,
  PRIVATE_LABEL_RAG_EMBEDDING_DIMENSIONS,
  PrivateLabelRagChunkSchema,
  PrivateLabelRagCitationSchema,
  PrivateLabelRagQuerySchema,
  PrivateLabelRagRetrievedChunkSchema,
  PrivateLabelRagScopeSchema,
  PrivateLabelRagSectionSchema,
  PrivateLabelRagSourceStateSchema,
  PrivateLabelRagWorkspaceScopeSchema,
} from "./private-label-rag-types.js";
/** Compatibility alias; prefer PRIVATE_LABEL_VERIFIED_COLLECTION. */
export { PRIVATE_LABEL_VERIFIED_COLLECTION as PRIVATE_LABEL_PRELIMINARY_COLLECTION } from "./private-label-rag-types.js";
export type {
  ParsedPrivateLabelRagQuery,
  PrivateLabelRagChunk,
  PrivateLabelRagCitation,
  PrivateLabelRagQuery,
  PrivateLabelRagRetrievedChunk,
  PrivateLabelRagSafeRetrievalResult,
  PrivateLabelRagScope,
  PrivateLabelRagSection,
  PrivateLabelRagSourceState,
  PrivateLabelRagWorkspaceScope,
} from "./private-label-rag-types.js";
