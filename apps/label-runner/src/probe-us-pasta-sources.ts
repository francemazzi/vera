import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_ACTS = [
  "21 CFR 101",
  "21 CFR 101.12",
  "21 CFR 139",
  "7 CFR 205",
] as const;

const CATALOG_URLS = [
  "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101",
  "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.12",
  "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-139",
  "https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-M/part-205",
] as const;

/**
 * Records whether live Chroma or official eCFR URLs can support US pasta citations.
 * Never prints statutory quotes.
 */
async function main(): Promise<void> {
  const endpoint = process.env["CHROMA_ENDPOINT"]?.trim();
  const urlStatus = await Promise.all(
    CATALOG_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { method: "HEAD", redirect: "follow" });
        return { url, ok: response.ok, status: response.status };
      } catch {
        return { url, ok: false, status: 0 };
      }
    }),
  );
  const output = {
    requiredActs: REQUIRED_ACTS,
    catalogKeys: ["us-21-cfr-101", "us-21-cfr-139", "us-7-cfr-205"],
    chromaConfigured: Boolean(endpoint),
    officialUrlsReachable: urlStatus.every((item) => item.ok),
    urlStatus,
    note: endpoint
      ? "Chroma endpoint present; operational retrieval still requires an approved snapshot and workspace."
      : "Chroma was not queried. Catalog candidates us-21-cfr-101, us-21-cfr-139 and us-7-cfr-205 must be approved via source discovery before FAIL citations can come from RAG. Replay uses deterministic 21 CFR excerpts only as evaluator input, not as a Chroma snapshot.",
    gggPolicy:
      "GGG / California AB 660 remains a case supporting document, never a federal RAG source.",
  };
  const reportPath = path.join(
    fileURLToPath(new URL("../../..", import.meta.url)),
    ".vera-private/cipriani-pasta-rag-probe.json",
  );
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...output, urlStatus: urlStatus.map((item) => item.status) })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "RAG probe failed"}\n`);
  process.exitCode = 1;
});
