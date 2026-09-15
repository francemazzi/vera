import { z } from "zod";

/** A claim is assessed literally, with its own evidence, use conditions and rewrite. */
export const ClaimAssessmentSchema = z
  .object({
    text: z.string().min(1).max(2000),
    language: z.string().min(2).max(35),
    outcome: z.enum(["SUPPORTED", "REJECTED", "UNRESOLVED"]),
    rationale: z.string().min(1).max(2000),
    conditions: z.string().min(1).max(2000).catch("Not specified"),
    productEvidence: z.string().min(1).max(2000),
    proposedWording: z.string().min(1).max(2000).optional().catch(undefined),
    citationChunkIds: z.array(z.string().min(1).max(300)).max(24).catch([]),
  })
  .strict();
