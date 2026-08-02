import { describe, expect, it, vi } from "vitest";

import { createLabelGovernanceServer } from "../../src/server.js";
import { SourceDiscoveryJobError } from "../../src/source-discovery-jobs.js";

const job = {
  kind: "DISCOVER_OFFICIAL_SOURCES",
  discoveryRunId: "00000000-0000-4000-8000-000000000631",
} as const;

describe("private source-discovery HTTP boundary", () => {
  it("accepts a Cloud Tasks identity for opaque discovery jobs only", async () => {
    const backendAuthorizer = { authorize: vi.fn().mockRejectedValue(new Error("not backend")) };
    const taskAuthorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const processor = {
      process: vi.fn().mockResolvedValue({
        discoveryRunId: job.discoveryRunId,
        kind: job.kind,
        proposalsCreated: 1,
      }),
    };
    const server = await createLabelGovernanceServer({
      authorizer: backendAuthorizer,
      sourceJobAuthorizer: taskAuthorizer,
      classifier: { classify: vi.fn() },
      sourceDiscoveryJobProcessor: processor,
    });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-discovery-jobs",
      headers: { authorization: "Bearer task-oidc" },
      payload: job,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "success", meta: { proposalsCreated: 1 } });
    expect(processor.process).toHaveBeenCalledWith(job);
    await server.close();
  });

  it("returns 503 only after the discovery processor persisted a retryable failure", async () => {
    const processor = {
      process: vi
        .fn()
        .mockRejectedValue(new SourceDiscoveryJobError("temporary source portal outage", true)),
    };
    const server = await createLabelGovernanceServer({
      authorizer: { authorize: vi.fn().mockResolvedValue(undefined) },
      classifier: { classify: vi.fn() },
      sourceDiscoveryJobProcessor: processor,
    });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-discovery-jobs",
      headers: { authorization: "Bearer backend-oidc" },
      payload: job,
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.json()).toEqual({ status: "error", code: "SOURCE_DISCOVERY_RETRYABLE" });
    await server.close();
  });

  it("never invokes discovery before validating the internal OIDC identity", async () => {
    const processor = { process: vi.fn() };
    const server = await createLabelGovernanceServer({
      authorizer: { authorize: vi.fn().mockRejectedValue(new Error("invalid")) },
      classifier: { classify: vi.fn() },
      sourceDiscoveryJobProcessor: processor,
    });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-discovery-jobs",
      payload: job,
    });

    expect(response.statusCode).toBe(401);
    expect(processor.process).not.toHaveBeenCalled();
    await server.close();
  });
});
