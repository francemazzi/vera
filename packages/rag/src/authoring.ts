import { sha256CanonicalJson } from "@vera/contracts";

import { RagError } from "./errors.js";
import type { RuleDraftProvider } from "./providers.js";
import {
  RuleCardDraftGenerationResultSchema,
  RuleCardDraftSuggestionSchema,
  RuleCardWorkflowAdvancementRequestSchema,
} from "./types.js";
import type {
  RagCitation,
  RagRetrievedChunk,
  RuleCardDraftGenerationResult,
  RuleCardDraftSuggestion,
  RuleCardWorkflowAdvancementRequest,
} from "./types.js";

export interface DraftPromptInput {
  readonly instruction: string;
  readonly chunks: readonly RagRetrievedChunk[];
}

export interface DraftGenerationOptions extends DraftPromptInput {
  readonly provider: RuleDraftProvider;
  readonly generatedAt: string;
}

function parseJsonObject(rawOutput: string): unknown {
  try {
    return JSON.parse(rawOutput) as unknown;
  } catch (cause) {
    throw new RagError("DRAFT_INVALID", "Rule Card draft provider returned invalid JSON", {
      cause,
    });
  }
}

function chunkMap(chunks: readonly RagRetrievedChunk[]): ReadonlyMap<string, RagRetrievedChunk> {
  return new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
}

function validateDraftCitations(
  draft: RuleCardDraftSuggestion,
  chunks: ReadonlyMap<string, RagRetrievedChunk>,
): readonly RagCitation[] {
  const referenced = new Set<string>();
  draft.citations.forEach((citation) => {
    referenced.add(citation.chunkId);
  });
  draft.evidenceRequirements.forEach((requirement) => {
    requirement.citationChunkIds.forEach((chunkId) => referenced.add(chunkId));
  });
  draft.exceptions.forEach((exception) => {
    exception.citationChunkIds.forEach((chunkId) => referenced.add(chunkId));
  });

  for (const chunkId of referenced) {
    if (!chunks.has(chunkId)) {
      throw new RagError("DRAFT_INVALID", "Rule Card draft referenced an unknown citation", {
        details: { chunkId },
      });
    }
  }

  const referencedChunks = [...referenced].map((chunkId) => {
    const chunk = chunks.get(chunkId);
    if (chunk === undefined) {
      throw new RagError("DRAFT_INVALID", "Rule Card draft referenced an unknown citation", {
        details: { chunkId },
      });
    }
    return chunk;
  });
  const sourceIds = new Set(referencedChunks.map((chunk) => chunk.sourceId));
  const sourceVersionIds = new Set(referencedChunks.map((chunk) => chunk.sourceVersionId));
  if (sourceIds.size !== 1 || sourceVersionIds.size !== 1) {
    throw new RagError("DRAFT_INVALID", "Rule Card draft citations span multiple sources", {
      details: {
        sourceIds: [...sourceIds].sort(),
        sourceVersionIds: [...sourceVersionIds].sort(),
      },
    });
  }
  if (
    referencedChunks.some(
      (chunk) =>
        chunk.sourceId !== draft.sourceId || chunk.sourceVersionId !== draft.sourceVersionId,
    )
  ) {
    throw new RagError("DRAFT_INVALID", "Rule Card draft source does not match its citations", {
      details: { sourceId: draft.sourceId, sourceVersionId: draft.sourceVersionId },
    });
  }
  if (!referencedChunks.some((chunk) => chunk.sectionId === draft.sourceSection)) {
    throw new RagError("DRAFT_INVALID", "Rule Card draft sourceSection is not cited", {
      details: { sourceSection: draft.sourceSection },
    });
  }
  for (const citation of draft.citations) {
    const chunk = chunks.get(citation.chunkId);
    if (chunk === undefined) {
      throw new RagError("DRAFT_INVALID", "Rule Card draft referenced an unknown citation", {
        details: { chunkId: citation.chunkId },
      });
    }
    if (!chunk.text.includes(citation.quote)) {
      throw new RagError("DRAFT_INVALID", "Rule Card draft quote is not grounded in its chunk", {
        details: { chunkId: citation.chunkId },
      });
    }
  }

  return [...referenced].sort().map((chunkId) => {
    const chunk = chunks.get(chunkId);
    if (chunk === undefined) {
      throw new RagError("DRAFT_INVALID", "Rule Card draft referenced an unknown citation", {
        details: { chunkId },
      });
    }
    return chunk.citation;
  });
}

export function buildRuleCardDraftPrompt(input: DraftPromptInput): string {
  if (input.chunks.length === 0) {
    throw new RagError("DRAFT_INVALID", "At least one retrieved chunk is required");
  }

  const citations = input.chunks
    .map(
      (chunk, index) =>
        `[C${String(index + 1)} chunkId=${chunk.chunkId} sourceVersionId=${
          chunk.sourceVersionId
        } section=${chunk.sectionId}]\n${chunk.text}`,
    )
    .join("\n\n");

  return `You assist editorial drafting for VERA TECHNICAL_DEMO data.
Return only JSON matching the RuleCardDraftSuggestion schema.
The only allowed targetState is "DRAFT".
Never produce APPROVED, IN_REVIEW, findings, verdicts or compliance decisions.
Every evidence requirement and exception must cite chunkId values from the provided citations.

Instruction:
${input.instruction}

Citations:
${citations}`;
}

export async function generateRuleCardDraft(
  options: DraftGenerationOptions,
): Promise<RuleCardDraftGenerationResult> {
  const prompt = buildRuleCardDraftPrompt(options);
  const providerResult = await options.provider.generateJson(prompt);
  const draft = RuleCardDraftSuggestionSchema.parse(parseJsonObject(providerResult.rawOutput));
  const citations = validateDraftCitations(draft, chunkMap(options.chunks));

  return RuleCardDraftGenerationResultSchema.parse({
    draft,
    log: {
      prompt,
      promptHash: sha256CanonicalJson({ prompt }),
      rawOutput: providerResult.rawOutput,
      attempts: providerResult.attempts,
      generatedAt: options.generatedAt,
      provider: providerResult.provider,
      generationId: providerResult.generationId ?? null,
      responseModel: providerResult.responseModel ?? null,
      upstreamProvider: providerResult.upstreamProvider ?? null,
      systemFingerprint: providerResult.systemFingerprint ?? null,
      usage: providerResult.usage ?? null,
      responseSchemaHash: providerResult.responseSchemaHash ?? null,
      citations,
    },
    requiresHumanConfirmation: true,
  });
}

export function createRuleCardWorkflowAdvancementRequest(
  draft: RuleCardDraftSuggestion,
): RuleCardWorkflowAdvancementRequest {
  return RuleCardWorkflowAdvancementRequestSchema.parse({
    draftTargetState: "DRAFT",
    requestedNextState: "IN_REVIEW",
    requiresHumanConfirmation: true,
    rationaleRequired: true,
    draft,
  });
}
