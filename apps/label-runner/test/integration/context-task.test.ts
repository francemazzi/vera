import { describe, expect, it, vi } from "vitest";
import { createLabelRunnerServer } from "../../src/server.js";
import { createContextProcessor } from "../../src/create-context-processor.js";
import { createContextResolver } from "../../src/create-context-resolver.js";
import { createBackendRequest } from "../../src/backend-request.js";

const analysisId = "00000000-0000-4000-8000-000000000201";
describe("RESOLVE_CONTEXT HTTP routing and backend transport", () => {
  it("claims and returns the resolver result using the existing authenticated backend client", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          data: {
            acquired: true,
            analysisId,
            version: 7,
            contextRevision: 2,
            defaultEvaluationDate: "2026-09-10",
            messages: [{ role: "USER", content: "Europa" }],
            documents: [],
            countries: [
              { code: "IT", name: "Italy", localizedName: "Italia", defaultLanguage: "it" },
            ],
          },
        }),
      ),
      new Response(JSON.stringify({ status: "success" })),
    ];
    const backendFetch = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
    vi.stubGlobal("fetch", backendFetch);
    const processor = { process: vi.fn() };
    const contextProcessor = createContextProcessor({
      request: createBackendRequest({
        backendUrl: "http://127.0.0.1:9999",
        audience: "synthetic",
        localToken: "synthetic-test-token",
      }),
      model: "google/gemini-2.5-flash",
      resolve: createContextResolver({
        apiKey: "synthetic",
        model: "google/gemini-2.5-flash",
        timeoutMs: 5000,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      status: "NEEDS_INPUT",
                      question: "Quali paesi europei?",
                    }),
                  },
                },
              ],
            }),
          ),
        ),
      }),
    });
    const server = await createLabelRunnerServer({
      authorizer: { authorize: vi.fn().mockResolvedValue(undefined) },
      processor,
      contextProcessor,
    });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/internal/label-jobs",
        payload: { analysisId, kind: "RESOLVE_CONTEXT", contextRevision: 2 },
      });
      expect(response.statusCode).toBe(200);
      expect(processor.process).not.toHaveBeenCalled();
      expect(backendFetch.mock.calls[0]![0]).toContain("context-claim");
      expect(backendFetch.mock.calls[1]![0]).toContain("context-result");
      const result = JSON.parse(String(backendFetch.mock.calls[1]![1]!.body)) as Record<
        string,
        unknown
      >;
      expect(result).toMatchObject({
        expectedVersion: 7,
        contextRevision: 2,
        result: { status: "NEEDS_INPUT", question: "Quali paesi europei?" },
      });
      expect(backendFetch.mock.calls[1]![1]!.headers).toMatchObject({
        Authorization: "Bearer synthetic-test-token",
      });
    } finally {
      await server.close();
      vi.unstubAllGlobals();
    }
  });
  it("refuses missing revisions and does not send context tasks to an old evaluation worker", async () => {
    const processor = { process: vi.fn() };
    const server = await createLabelRunnerServer({
      authorizer: { authorize: vi.fn().mockResolvedValue(undefined) },
      processor,
    });
    try {
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/internal/label-jobs",
            payload: { analysisId, kind: "RESOLVE_CONTEXT" },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/internal/label-jobs",
            payload: { analysisId, kind: "RESOLVE_CONTEXT", contextRevision: 0 },
          })
        ).statusCode,
      ).toBe(503);
      expect(processor.process).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
