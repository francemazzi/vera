import {
  archivePinnedPreliminarySources,
  readPreliminarySourceArchiveConfig,
} from "./preliminary-source-archive.js";

async function main(): Promise<void> {
  const archived = await archivePinnedPreliminarySources({
    config: readPreliminarySourceArchiveConfig(),
  });
  // Deliberately log only object identifiers and digests, never source bodies.
  console.log(JSON.stringify({ status: "archived", ...archived }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown archive failure";
  console.error(`Preliminary source archive failed: ${message}`);
  process.exitCode = 1;
});
