import { randomUUID } from "node:crypto";
import { createBackendRequest } from "./backend-request.js";
import { createContextResolver } from "./create-context-resolver.js";
import { contextContracts } from "./context-contracts.js";

/** Claims a versioned context task and records recoverable failures without losing uploads. */
export function createContextProcessor(options: {
  request: ReturnType<typeof createBackendRequest>;
  resolve: ReturnType<typeof createContextResolver>;
  model: string;
}) {
  return {
    async process(analysisId: string, contextRevision: number): Promise<{ acquired: boolean }> {
      const invocationId: string = randomUUID();
      const prefix: string = `/internal/label/analyses/${analysisId}`;
      const response = (await options.request(`${prefix}/context-claim`, "POST", {
        contextRevision,
        invocationId,
      })) as { data: unknown };
      const claim = contextContracts.claim.parse(response.data);
      if (!claim.acquired) return { acquired: false };
      const complete = (result: unknown): Promise<unknown> =>
        options.request(`${prefix}/context-result`, "POST", {
          invocationId,
          contextRevision,
          expectedVersion: claim.version,
          result,
        });
      try {
        await complete(await options.resolve(claim));
      } catch {
        // If the success callback was accepted but its response was lost, backend replay wins.
        await complete({
          status: "RETRYABLE_ERROR",
          promptVersion: "label-context-v1",
          model: options.model,
        });
      }
      return { acquired: true };
    },
  };
}
