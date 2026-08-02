import { Storage } from "@google-cloud/storage";

import type { RunnerInput } from "./contracts.js";

export interface LabelPageStore {
  loadNormalizedPages(input: RunnerInput): Promise<readonly Readonly<{ page: number; bytes: Uint8Array }>[]>;
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
    async loadNormalizedPages(input) {
      return Promise.all(
        input.normalizedPages.map(async (page) => {
          const [bytes] = await bucket.file(page.objectKey).download();
          if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
            throw new Error("Normalized label page has an invalid size");
          }
          return { page: page.page, bytes };
        }),
      );
    },
  };
}
