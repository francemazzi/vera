import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CiprianiPastaGoldCase } from "./cipriani-pasta-gold.js";

const execFileAsync = promisify(execFile);

type SharpFactory = (input: Uint8Array) => {
  rotate(): ReturnType<SharpFactory>;
  resize(options: Readonly<{
    width: number;
    height: number;
    fit: "inside";
    withoutEnlargement: boolean;
  }>): ReturnType<SharpFactory>;
  png(): ReturnType<SharpFactory>;
  toBuffer(): Promise<Buffer>;
};

async function renderPdfPages(file: string, page?: number): Promise<readonly Buffer[]> {
  const directory = await mkdtemp(path.join(tmpdir(), "silto-cipriani-pages-"));
  const input = path.join(directory, "input.pdf");
  const output = path.join(directory, "page");
  try {
    await writeFile(input, await readFile(file));
    const args =
      page === undefined
        ? ["-png", input, output]
        : ["-png", "-f", String(page), "-l", String(page), input, output];
    await execFileAsync("pdftoppm", args, { maxBuffer: 32 * 1024 * 1024, timeout: 90_000 });
    const names = (await readdir(directory))
      .filter((name) => /^page(-\d+)?\.png$/u.test(name) || /^page-\d+\.png$/u.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    if (names.length === 0) throw new Error(`No pages rendered for ${file}`);
    return Promise.all(names.map((name) => readFile(path.join(directory, name))));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Normalizes Cipriani artwork into evaluator PNG pages, splitting multi-SKU lids.
 */
export async function loadCiprianiPastaPages(input: {
  readonly datasetRoot: string;
  readonly gold: CiprianiPastaGoldCase;
  readonly sharp: SharpFactory;
}): Promise<readonly Buffer[]> {
  const buffers: Buffer[] = [];
  for (const relative of input.gold.labelFiles) {
    const file = path.join(input.datasetRoot, relative);
    const extension = path.extname(file).toLowerCase();
    const rawPages =
      extension === ".pdf"
        ? await renderPdfPages(
            file,
            relative.endsWith("coperchi-250g.pdf") ? input.gold.lidPage : undefined,
          )
        : [await readFile(file)];
    const normalized = await Promise.all(
      rawPages.map((bytes) =>
        input.sharp(bytes)
          .rotate()
          .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer(),
      ),
    );
    buffers.push(...normalized);
  }
  return buffers;
}
