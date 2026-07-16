export {
  createLocalExtractorRun,
  defaultExtractorRuntime,
  elapsedMilliseconds,
  parseExtractionRequest,
  parseExtractionResult,
  parseRuntimeTimestamp,
  requireAdapterIdentity,
  requireInputKind,
} from "./adapter.js";
export type { ExtractionRequestFor, ExtractorAdapter, ExtractorRuntime } from "./adapter.js";
export {
  EXTRACTOR_ERROR_CODES,
  ExtractorError,
  ExtractorNormalizationError,
  ExtractorValidationError,
} from "./errors.js";
export type { ExtractorErrorCode, ExtractorErrorDetails } from "./errors.js";
export { JsonExtractorAdapter, resolveJsonPointer } from "./json-adapter.js";
export type { JsonFactMapping } from "./json-adapter.js";
export { ManualExtractorAdapter, materializeFactObservations } from "./manual-adapter.js";
export {
  normalizeDecimal,
  normalizeIsoDate,
  normalizeUnicode,
  normalizeUtcDateTime,
} from "./normalization.js";
export {
  OllamaEmbeddingAdapter,
  OllamaLlmAdapter,
  OllamaOcrAdapter,
  OllamaVisionAdapter,
} from "./ollama-adapters.js";
export type {
  OllamaEmbeddingAdapterOptions,
  OllamaFactAdapterOptions,
  OllamaModelConfig,
} from "./ollama-adapters.js";
export { OpenRouterLlmAdapter } from "./openrouter-adapter.js";
export type { OpenRouterLlmAdapterOptions } from "./openrouter-adapter.js";
export { OllamaClient, OllamaClientError } from "./ollama-client.js";
export type {
  OllamaChatMessage,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaClientErrorCode,
  OllamaClientOptions,
  OllamaEmbedRequest,
  OllamaEmbedResponse,
  OllamaModelIdentity,
  OllamaTransportResult,
  OllamaVerifiedModel,
} from "./ollama-client.js";
export {
  OPENROUTER_API_VERSION,
  OPENROUTER_CHAT_MODEL,
  OPENROUTER_PROVIDER_POLICY,
  OPENROUTER_ROUTING_CONFIG_HASH,
  OpenRouterClient,
  OpenRouterClientError,
} from "./openrouter-client.js";
export type {
  OpenRouterChatMessage,
  OpenRouterChatRequest,
  OpenRouterChatResponse,
  OpenRouterClientErrorCode,
  OpenRouterClientOptions,
  OpenRouterModelIdentity,
  OpenRouterResponseFormat,
  OpenRouterTransportResult,
  OpenRouterUsage,
} from "./openrouter-client.js";
