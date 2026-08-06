import { describe, expect, it, vi } from "vitest";

import { createSourceBackendClient } from "../../src/source-backend-client.js";

const candidateId = "00000000-0000-4000-8000-000000000701";
const classificationRunId = "00000000-0000-4000-8000-000000000702";
const invocationId = "00000000-0000-4000-8000-000000000703";

describe("source backend client artifact reservation", () => {
  it("preserves the curated official-HTML format from the private worker input", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        status: "success",
        data: {
          candidateId,
          classificationRunId,
          kind: "CLASSIFY",
          source: {
            batchId: "00000000-0000-4000-8000-000000000704",
            sourceVersion: 1,
            sourceKind: "TABULAR",
            sourceFormat: "OFFICIAL_HTML",
            stageStatus: "DISCOVERED",
            governanceStatus: null,
            classificationStatus: "QUEUED",
            verifiedRagStatus: "NOT_REQUESTED",
            ragStatus: "NOT_REQUESTED",
            sourceTitle: "Norma ufficiale",
            pdfUrl: null,
            canonicalUrl: "https://normattiva.it/uri-res/N2Ls?urn:nir:stato:test",
            storageObjectKey:
              "label-governance/sources/00000000-0000-4000-8000-000000000704/00000000-0000-4000-8000-000000000701/source.html",
            extractedTextObjectKey: null,
            sourceSha256: "b".repeat(64),
            contentByteSize: 123,
            jurisdiction: "IT",
            language: "it",
            documentType: "Decreto legislativo",
            actReference: "D.Lgs. 231/2017",
            revisionLabel: "testo-vigente",
            validFrom: "2018-05-09",
            validTo: null,
            productCategories: ["generic-prepacked"],
            notes: null,
            classificationJson: null,
          },
        },
      },
    });
    const getIdTokenClient = vi.fn().mockResolvedValue({ request });
    const client = createSourceBackendClient({
      backendUrl: "https://silto-gfsi-be.internal.example",
      audience: "https://silto-gfsi-be.internal.example",
      auth: { getIdTokenClient } as never,
    });

    await expect(
      client.getInput({ candidateId, classificationRunId, kind: "CLASSIFY" }),
    ).resolves.toMatchObject({
      sourceFormat: "OFFICIAL_HTML",
      stageStatus: "DISCOVERED",
      verifiedRagStatus: "NOT_REQUESTED",
      storageObjectKey: expect.stringContaining("/source.html"),
    });
  });

  it("accepts the backend verified-RAG lifecycle in a strict worker lease payload", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        status: "success",
        data: {
          candidateId,
          kind: "INDEX_VERIFIED",
          classificationRunId: null,
          stageStatus: "SUBMITTED",
          classificationStatus: "COMPLETED",
          verifiedRagStatus: "QUEUED",
          ragStatus: "NOT_REQUESTED",
          lease: { expiresAt: "2026-07-20T12:00:00.000Z" },
        },
        meta: { acquired: true, replayed: false },
      },
    });
    const client = createSourceBackendClient({
      backendUrl: "https://silto-gfsi-be.internal.example",
      audience: "https://silto-gfsi-be.internal.example",
      auth: { getIdTokenClient: vi.fn().mockResolvedValue({ request }) } as never,
    });

    await expect(
      client.claim({
        candidateId,
        kind: "INDEX_VERIFIED",
        classificationRunId: null,
        workerInvocationId: invocationId,
      }),
    ).resolves.toEqual({ acquired: true, replayed: false });
  });

  it("sends a PROCESSING artifact preflight and exposes terminal duplicate metadata", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        status: "success",
        data: { candidateId },
        meta: { replayed: false, duplicate: true },
      },
    });
    const getIdTokenClient = vi.fn().mockResolvedValue({ request });
    const client = createSourceBackendClient({
      backendUrl: "https://silto-gfsi-be.internal.example",
      audience: "https://silto-gfsi-be.internal.example",
      auth: { getIdTokenClient } as never,
    });

    await expect(
      client.reserveArtifacts({
        candidateId,
        callback: {
          kind: "CLASSIFY",
          classificationRunId,
          workerInvocationId: invocationId,
          status: "PROCESSING",
          artifacts: {
            sourceSha256: "a".repeat(64),
            storageObjectKey: `label-governance/sources/batch/${candidateId}/original/a.pdf`,
            extractedTextObjectKey: `label-governance/sources/batch/${candidateId}/extracted/a.json`,
            contentByteSize: 1_024,
          },
        },
      }),
    ).resolves.toEqual({ replayed: false, duplicate: true });

    expect(getIdTokenClient).toHaveBeenCalledWith("https://silto-gfsi-be.internal.example");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: `https://silto-gfsi-be.internal.example/internal/label/sources/${candidateId}/worker-callback`,
        data: expect.objectContaining({ status: "PROCESSING", artifacts: expect.any(Object) }),
      }),
    );
  });
});
