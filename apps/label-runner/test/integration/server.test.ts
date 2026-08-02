import { describe, expect, it, vi } from "vitest";

import { createLabelRunnerServer, createLabelRunnerStandbyServer } from "../../src/server.js";

const analysisId = "00000000-0000-4000-8000-000000000201";

describe("Label runner HTTP boundary", () => {
  it("reports readiness but refuses jobs while it is in standby", async () => {
    const server = await createLabelRunnerStandbyServer();

    const health = await server.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", mode: "standby" });

    const job = await server.inject({
      method: "POST",
      url: "/internal/label-jobs",
      payload: { analysisId },
    });
    expect(job.statusCode).toBe(503);
    expect(job.json()).toEqual({ status: "error", code: "RUNNER_STANDBY" });
    await server.close();
  });

  it("rejects a task without a verified OIDC identity", async () => {
    const authorizer = { authorize: vi.fn().mockRejectedValue(new Error("missing token")) };
    const processor = { process: vi.fn() };
    const server = await createLabelRunnerServer({ authorizer, processor });

    const response = await server.inject({
      method: "POST",
      url: "/internal/label-jobs",
      payload: { analysisId },
    });

    expect(response.statusCode).toBe(401);
    expect(processor.process).not.toHaveBeenCalled();
    await server.close();
  });

  it("accepts only the analysis ID after OIDC verification and returns an idempotent acknowledgement", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const processor = { process: vi.fn().mockResolvedValue({ replayed: true }) };
    const server = await createLabelRunnerServer({ authorizer, processor });

    const response = await server.inject({
      method: "POST",
      url: "/internal/label-jobs",
      headers: { authorization: "Bearer synthetic-oidc" },
      payload: { analysisId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "success", meta: { replayed: true } });
    expect(processor.process).toHaveBeenCalledWith(analysisId);
    await server.close();
  });

  it("does not accept task payload fields other than analysisId", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const processor = { process: vi.fn() };
    const server = await createLabelRunnerServer({ authorizer, processor });

    const response = await server.inject({
      method: "POST",
      url: "/internal/label-jobs",
      payload: { analysisId, objectKey: "must-not-cross-the-queue" },
    });

    expect(response.statusCode).toBe(400);
    expect(processor.process).not.toHaveBeenCalled();
    await server.close();
  });
});
