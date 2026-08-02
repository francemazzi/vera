import { z } from "zod";

export const SourceDiscoveryJobSchema = z
  .object({
    kind: z.literal("DISCOVER_OFFICIAL_SOURCES"),
    discoveryRunId: z.uuid(),
  })
  .strict();

export type SourceDiscoveryJob = z.infer<typeof SourceDiscoveryJobSchema>;

export type SourceDiscoveryJobResult = Readonly<{
  discoveryRunId: string;
  kind: SourceDiscoveryJob["kind"];
  replayed?: boolean;
  proposalsCreated?: number;
  skippedCandidates?: number;
}>;

export class SourceDiscoveryJobError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "SourceDiscoveryJobError";
  }
}

/**
 * Private Cloud Tasks worker boundary for source discovery. Jobs contain only
 * a discovery run UUID; no browser actor, source URL, text, file bytes or
 * OpenRouter credential ever crosses the queue or public HTTP boundary.
 */
export interface SourceDiscoveryJobProcessor {
  process(job: SourceDiscoveryJob): Promise<SourceDiscoveryJobResult>;
}

export function createUnavailableSourceDiscoveryJobProcessor(): SourceDiscoveryJobProcessor {
  return {
    process() {
      return Promise.reject(
        new SourceDiscoveryJobError("Source discovery processor is not configured", true),
      );
    },
  };
}
