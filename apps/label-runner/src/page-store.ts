import { Storage } from "@google-cloud/storage";

import type { RunnerInput } from "./contracts.js";

export interface LabelPageStore {
  loadNormalizedPage(input: RunnerInput): Promise<Uint8Array>;
}

export function createGcsLabelPageStore(options: {
  readonly bucketName: string;
  readonly projectId: string;
  readonly storage?: Storage;
}): LabelPageStore {
  const storage = options.storage ?? new Storage({ projectId: options.projectId });
  const bucket = storage.bucket(options.bucketName);
  return {
    async loadNormalizedPage(input) {
      const [bytes] = await bucket.file(input.normalizedPageObjectKey).download();
      if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
        throw new Error("Normalized label page has an invalid size");
      }
      return bytes;
    },
  };
}
