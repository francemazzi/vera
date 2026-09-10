import { createHash } from "node:crypto";
import { Storage } from "@google-cloud/storage";

import type { RunnerInput } from "./contracts.js";

export interface LabelPageStore {
  loadSupportingDocuments?(input: RunnerInput): Promise<
    readonly Readonly<{
      id: string;
      fileName: string;
      productReference: string;
      revision: string;
      pages: readonly Readonly<{ page: number; bytes: Uint8Array; text?: string }>[];
    }>[]
  >;
  loadNormalizedPages(
    input: RunnerInput,
  ): Promise<readonly Readonly<{ page: number; bytes: Uint8Array; text?: string }>[]>;
}

function createEmulatorAwareStorage(projectId: string): Storage {
  const configured =
    process.env["LABEL_GCS_API_ENDPOINT"]?.trim() || process.env["STORAGE_EMULATOR_HOST"]?.trim();
  if (configured || process.env["LABEL_LOCAL_MODE"] === "true") {
    const host = configured || "http://localhost:4443";
    const apiEndpoint =
      host.startsWith("http://") || host.startsWith("https://") ? host : `http://${host}`;
    // apiEndpoint alone works with fake-gcs; STORAGE_EMULATOR_HOST breaks downloads.
    delete process.env["STORAGE_EMULATOR_HOST"];
    return new Storage({ projectId, apiEndpoint });
  }
  return new Storage({ projectId });
}

export function createGcsLabelPageStore(options: {
  readonly bucketName: string;
  readonly projectId: string;
  readonly storage?: Storage;
}): LabelPageStore {
  const storage = options.storage ?? createEmulatorAwareStorage(options.projectId);
  const bucket = storage.bucket(options.bucketName);
  return {
    async loadSupportingDocuments(input) {
      return Promise.all(
        (input.supportingDocuments ?? []).map(async (document) => ({
          ...document,
          pages: await Promise.all(
            document.pages.map(async (page) => {
              const [bytes] = await bucket.file(page.objectKey).download();
              if (createHash("sha256").update(bytes).digest("hex") !== page.sha256)
                throw new Error("Supporting evidence hash mismatch");
              if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024)
                throw new Error("Supporting page has an invalid size");
              return { page: page.page, bytes, ...(page.text ? { text: page.text } : {}) };
            }),
          ),
        })),
      );
    },
    async loadNormalizedPages(input) {
      return Promise.all(
        input.normalizedPages.map(async (page) => {
          const [bytes] = await bucket.file(page.objectKey).download();
          if (
            input.preliminaryTemplate.version === "3" &&
            createHash("sha256").update(bytes).digest("hex") !== page.sha256
          )
            throw new Error("Artwork evidence hash mismatch");
          if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
            throw new Error("Normalized label page has an invalid size");
          }
          return { page: page.page, bytes, ...(page.text ? { text: page.text } : {}) };
        }),
      );
    },
  };
}
