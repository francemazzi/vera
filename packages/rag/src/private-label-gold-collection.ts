import { PRIVATE_LABEL_VERIFIED_COLLECTION } from "./private-label-rag-types.js";

/**
 * Gold few-shot embeddings never share the verified legal collection.
 */
export const PRIVATE_LABEL_GOLD_COLLECTION = "silto-label-gold-v1" as const;

export function isPrivateLabelGoldCollection(name: string): boolean {
  return name === PRIVATE_LABEL_GOLD_COLLECTION;
}

export function isPrivateLabelLegalCollection(name: string): boolean {
  return name === PRIVATE_LABEL_VERIFIED_COLLECTION || name.startsWith("silto-label-approved");
}
