import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");

export interface BlobDescriptor {
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly path: string;
}

export class ContentAddressedBlobStore {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = resolve(root);
  }

  public pathFor(sha256: string): string {
    const digest = Sha256DigestSchema.parse(sha256);
    return join(this.#root, digest.slice(0, 2), digest.slice(2, 4), digest);
  }

  public async put(bytes: Uint8Array, mediaType: string): Promise<BlobDescriptor> {
    const digest = createHash("sha256").update(bytes).digest("hex");
    const target = this.pathFor(digest);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid.toString()}.tmp`;
    await writeFile(temporary, bytes, { flag: "wx" }).catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        return;
      }
      throw error;
    });
    await rename(temporary, target).catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "EEXIST" || error.code === "ENOENT")
      ) {
        return;
      }
      throw error;
    });
    return { sha256: digest, byteLength: bytes.byteLength, mediaType, path: target };
  }

  public async get(sha256: string): Promise<Uint8Array> {
    return readFile(this.pathFor(sha256));
  }

  public async has(sha256: string): Promise<boolean> {
    return stat(this.pathFor(sha256)).then(
      () => true,
      () => false,
    );
  }
}
