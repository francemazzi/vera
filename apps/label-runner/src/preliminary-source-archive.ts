import { createHash } from "node:crypto";

import { Storage } from "@google-cloud/storage";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const ARCHIVE_PREFIX = "label-preliminary-sources/eu-it-preliminary-v1";

export const PRELIMINARY_SOURCE_ARCHIVES = [
  {
    id: "eu-1169",
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02011R1169-20250401",
    mediaType: "text/html",
  },
  {
    id: "eu-lot-2011-91",
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32011L0091",
    mediaType: "text/html",
  },
  {
    id: "it-231-2017",
    url: "https://www.normattiva.it/uri-res/N2Ls?urn%3Anir%3Astato%3Adecreto%3A2017-12-15%3B231=",
    mediaType: "text/html",
  },
] as const;

type SourceArchive = (typeof PRELIMINARY_SOURCE_ARCHIVES)[number];

export type PreliminarySourceArchiveConfig = Readonly<{
  bucketName: string;
  projectId: string;
  sourceSnapshot: string;
}>;

export type ArchivedPreliminarySource = Readonly<{
  id: SourceArchive["id"];
  objectKey: string;
  sha256: string;
}>;

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

export function readPreliminarySourceArchiveConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PreliminarySourceArchiveConfig {
  const sourceSnapshot = requiredEnvironment("LABEL_SOURCE_SNAPSHOT", environment);
  if (!/^[0-9a-f]{64}$/u.test(sourceSnapshot)) {
    throw new Error("LABEL_SOURCE_SNAPSHOT must be a SHA-256 digest");
  }
  return {
    bucketName: requiredEnvironment("LABEL_GCS_BUCKET", environment),
    projectId: requiredEnvironment("GCP_PROJECT_ID", environment),
    sourceSnapshot,
  };
}

function sourceObjectKey(source: SourceArchive, sha256: string): string {
  return `${ARCHIVE_PREFIX}/sources/${source.id}/${sha256}.html`;
}

async function downloadPinnedSource(
  source: SourceArchive,
  fetchImplementation: typeof globalThis.fetch,
): Promise<{ readonly bytes: Uint8Array; readonly sha256: string }> {
  const response = await fetchImplementation(source.url, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "text/html;q=1,*/*;q=0.1",
      "user-agent": "SILTO-Label preliminary source archivist/1.0",
    },
  });
  if (!response.ok) throw new Error(`Private source ${source.id} could not be downloaded`);
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (mediaType !== source.mediaType) {
    throw new Error(`Private source ${source.id} returned an unexpected media type`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Private source ${source.id} has an invalid size`);
  }
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function saveImmutableObject(input: {
  readonly storage: Storage;
  readonly bucketName: string;
  readonly objectKey: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly metadata: Record<string, string>;
}): Promise<void> {
  const file = input.storage.bucket(input.bucketName).file(input.objectKey);
  try {
    await file.save(input.bytes, {
      resumable: false,
      contentType: input.mediaType,
      metadata: {
        cacheControl: "no-store",
        metadata: input.metadata,
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    return;
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code !== 412) throw error;
  }

  const [metadata] = await file.getMetadata();
  const existingHash = metadata.metadata?.["sha256"];
  if (existingHash !== input.metadata["sha256"]) {
    throw new Error("An immutable source object already exists with different metadata");
  }
}

/**
 * Downloads only the three pinned official pages and writes content-addressed
 * objects in the private bucket. The emitted manifest contains identifiers and
 * hashes only; source bodies remain exclusively in object storage.
 */
export async function archivePinnedPreliminarySources(input: {
  readonly config: PreliminarySourceArchiveConfig;
  readonly storage?: Storage;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<{
  readonly manifestObjectKey: string;
  readonly sources: readonly ArchivedPreliminarySource[];
}> {
  const storage = input.storage ?? new Storage({ projectId: input.config.projectId });
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const bucket = storage.bucket(input.config.bucketName);
  const manifestObjectKey = `${ARCHIVE_PREFIX}/manifests/${input.config.sourceSnapshot}.json`;
  const existingManifest = bucket.file(manifestObjectKey);
  const [manifestExists] = await existingManifest.exists();
  if (manifestExists) {
    const [bytes] = await existingManifest.download();
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The private preliminary source manifest is invalid");
    }
    const manifest = parsed as { sourceSnapshot?: unknown; sources?: unknown };
    if (
      manifest.sourceSnapshot !== input.config.sourceSnapshot ||
      !Array.isArray(manifest.sources)
    ) {
      throw new Error(
        "The private preliminary source manifest does not match its template snapshot",
      );
    }
    const sources = manifest.sources.map((source): ArchivedPreliminarySource => {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error("The private preliminary source manifest contains an invalid source");
      }
      const value = source as Record<string, unknown>;
      if (
        (value["id"] !== "eu-1169" &&
          value["id"] !== "eu-lot-2011-91" &&
          value["id"] !== "it-231-2017") ||
        typeof value["objectKey"] !== "string" ||
        !/^[0-9a-f]{64}$/u.test(String(value["sha256"]))
      ) {
        throw new Error("The private preliminary source manifest contains an invalid source");
      }
      return {
        id: value["id"],
        objectKey: value["objectKey"],
        sha256: String(value["sha256"]),
      };
    });
    if (
      sources.length !== PRELIMINARY_SOURCE_ARCHIVES.length ||
      new Set(sources.map((source) => source.id)).size !== PRELIMINARY_SOURCE_ARCHIVES.length
    ) {
      throw new Error("The private preliminary source manifest does not cover every fixed source");
    }
    return { manifestObjectKey, sources };
  }
  const sources: ArchivedPreliminarySource[] = [];

  for (const source of PRELIMINARY_SOURCE_ARCHIVES) {
    const archivedSource = await downloadPinnedSource(source, fetchImplementation);
    const objectKey = sourceObjectKey(source, archivedSource.sha256);
    await saveImmutableObject({
      storage,
      bucketName: input.config.bucketName,
      objectKey,
      bytes: archivedSource.bytes,
      mediaType: source.mediaType,
      metadata: {
        sha256: archivedSource.sha256,
        sourceId: source.id,
        sourceState: "UNVERIFIED",
      },
    });
    sources.push({ id: source.id, objectKey, sha256: archivedSource.sha256 });
  }

  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      templateId: "eu-it-preliminary-v1",
      templateVersion: "1",
      sourceSnapshot: input.config.sourceSnapshot,
      sources,
    }),
  );
  await saveImmutableObject({
    storage,
    bucketName: input.config.bucketName,
    objectKey: manifestObjectKey,
    bytes: manifestBytes,
    mediaType: "application/json",
    metadata: {
      sha256: createHash("sha256").update(manifestBytes).digest("hex"),
      sourceSnapshot: input.config.sourceSnapshot,
      sourceState: "UNVERIFIED",
    },
  });
  return { manifestObjectKey, sources };
}
