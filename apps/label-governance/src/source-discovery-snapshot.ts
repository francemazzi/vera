/**
 * Discovery snapshots are written only by the private official-source agent.
 * The backend validates the exact key against the active authority profile
 * before it creates a candidate. VERA repeats the immutable-key checks here
 * before it reads a byte, rather than relying on a broad static host list
 * that cannot safely enumerate every national authority in the world.
 */
const UUID_PATH_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SHA256_PATH_SEGMENT = "[0-9a-f]{64}";
const DISCOVERY_SNAPSHOT_KEY = new RegExp(
  `^label-governance/source-discovery/${UUID_PATH_SEGMENT}/${UUID_PATH_SEGMENT}/original/(${SHA256_PATH_SEGMENT})\\.(pdf|html)$`,
  "u",
);

export interface DiscoverySnapshotIdentity {
  readonly sourceFormat: "PDF" | "OFFICIAL_HTML";
  readonly sourceSha256: string | null;
}

/**
 * Returns true only for the backend's immutable discovery naming convention:
 * run UUID, authority-profile UUID, declared SHA-256 and matching extension.
 * It deliberately does not accept a prefix, glob, redirect or arbitrary
 * object key; browser uploads remain constrained to a candidate prefix.
 */
export function isVerifiedDiscoverySnapshotObjectKey(
  input: DiscoverySnapshotIdentity,
  objectKey: string | null,
): boolean {
  if (objectKey === null || input.sourceSha256 === null) return false;
  const match = DISCOVERY_SNAPSHOT_KEY.exec(objectKey);
  if (match === null) return false;
  const expectedExtension = input.sourceFormat === "PDF" ? "pdf" : "html";
  return match[1] === input.sourceSha256 && match[2] === expectedExtension;
}
