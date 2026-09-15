import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CIPRIANI_PASTA_GOLD_CASES } from "./cipriani-pasta-gold.js";
import { CIPRIANI_PASTA_SOURCE_FILES } from "./cipriani-pasta-source-files.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function hashId(value: string): string {
  return `C_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

async function main(): Promise<void> {
  const labelsDir = requiredEnv("CIPRIANI_LABELS_DIR");
  const reportsDir = requiredEnv("CIPRIANI_REPORTS_DIR");
  const outputDir = path.resolve(
    process.argv[2] ??
      path.join(process.cwd(), "..", "..", "..", "silto-gfsi-be", "dataset_label_gt", "US", "cipriani-pasta-202609"),
  );
  await mkdir(path.join(outputDir, "4197-family"), { recursive: true });
  await mkdir(path.join(outputDir, "reports"), { recursive: true });
  for (const source of CIPRIANI_PASTA_SOURCE_FILES) {
    await copyFile(path.join(labelsDir, source.downloadName), path.join(outputDir, source.dest));
  }
  const reportNames = CIPRIANI_PASTA_GOLD_CASES.map((item) => path.basename(item.reportFile));
  for (const name of reportNames) {
    await copyFile(path.join(reportsDir, name), path.join(outputDir, "reports", name));
  }
  const jsonl = CIPRIANI_PASTA_GOLD_CASES.map((item) =>
    JSON.stringify({
      case_id: hashId(item.id),
      country_code: "US",
      cliente: "Cipriani Industria S.r.l.",
      marchio: "CIPRIANI",
      descrizione_prodotto: item.productName,
      paesi_destinatari: "UNITED STATES",
      family: item.family,
      split: item.split,
      file_etichetta: item.labelFiles,
      lid_page: item.lidPage ?? null,
      file_report: item.reportFile,
      validazioni: Object.entries(item.expected).map(([fieldCode, esito_normalizzato]) => ({
        field_code: fieldCode,
        esito_normalizzato,
        stato_revisione: "CONFIRMED",
      })),
      blocking_findings: item.blockingFindings,
    }),
  ).join("\n");
  await writeFile(path.join(outputDir, "ground_truth_US_cipriani_pasta.jsonl"), `${jsonl}\n`);
  await mkdir(path.join(outputDir, "cases"), { recursive: true });
  for (const item of CIPRIANI_PASTA_GOLD_CASES) {
    await writeFile(
      path.join(outputDir, "cases", `${item.id}.json`),
      `${JSON.stringify(
        {
          case_id: hashId(item.id),
          family: item.family,
          split: item.split,
          productName: item.productName,
          labelFiles: item.labelFiles,
          lidPage: item.lidPage ?? null,
          reportFile: item.reportFile,
          expected: item.expected,
          blockingFindings: item.blockingFindings,
          esito_complessivo: "NON VALIDABILE FINO AL RECEPIMENTO DELLE PRESCRIZIONI",
        },
        null,
        2,
      )}\n`,
    );
  }
  await writeFile(
    path.join(outputDir, "manifest_US_cipriani_pasta.json"),
    `${JSON.stringify(
      {
        country_code: "US",
        campaign: "cipriani-pasta-202609",
        n_cases: CIPRIANI_PASTA_GOLD_CASES.length,
        ggg_document: "missing — supply GGG Best By Date Labeling Standards before live date scoring",
        files: CIPRIANI_PASTA_GOLD_CASES.map((item) => ({
          case_id: hashId(item.id),
          case_name: item.productName,
          split: item.split,
          labelFiles: item.labelFiles,
          reportFile: item.reportFile,
        })),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify({ outputDir, cases: CIPRIANI_PASTA_GOLD_CASES.length })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "dataset build failed"}\n`);
  process.exitCode = 1;
});
