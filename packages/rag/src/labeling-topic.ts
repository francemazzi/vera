/**
 * Canonical labeling topic used when writing and querying Chroma metadata.
 * Historical records may store ALLERGENS or spaced titles.
 */
export function normalizeLabelingTopic(topic: string): string {
  return topic
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[_\s]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

/** Query variants so already-indexed uppercase topics still match. */
export function labelingTopicQueryValues(topic: string): readonly string[] {
  const trimmed = topic.trim();
  if (trimmed.length === 0) return [];
  return [
    ...new Set([
      normalizeLabelingTopic(trimmed),
      trimmed.toLocaleLowerCase("en-US"),
      trimmed.toLocaleUpperCase("en-US"),
      trimmed,
    ]),
  ];
}
