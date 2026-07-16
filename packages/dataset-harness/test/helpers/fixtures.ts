import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return chunk;
}

export function minimalPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const image = deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", image),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

interface ZipEntryFixture {
  readonly name: string;
  readonly content: string | Uint8Array;
}

/** Creates a small, standards-conformant ZIP using stored entries only. */
export function storedZip(entries: readonly ZipEntryFixture[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content =
      typeof entry.content === "string"
        ? Buffer.from(entry.content, "utf8")
        : Buffer.from(entry.content);
    const crc = crc32(content);
    const local = Buffer.alloc(30 + name.byteLength + content.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.byteLength, 18);
    local.writeUInt32LE(content.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    name.copy(local, 30);
    content.copy(local, 30 + name.byteLength);
    locals.push(local);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.byteLength, 20);
    central.writeUInt32LE(content.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centrals.push(central);
    localOffset += local.byteLength;
  }
  const centralBytes = centrals.reduce((total, entry) => total + entry.byteLength, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

export function minimalXlsx(): Buffer {
  return storedZip([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    },
    {
      name: "xl/workbook.xml",
      content: '<?xml version="1.0"?><workbook><sheets/></workbook>',
    },
  ]);
}

export interface TestRepository {
  readonly root: string;
  readonly dataset: string;
  readonly privateConfig: string;
  readonly report: string;
}

export async function makeTestRepository(): Promise<TestRepository> {
  const root = await mkdtemp(join(tmpdir(), "vera-dataset-harness-"));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(
    join(root, ".gitignore"),
    "datasets/\nreports/private/\n.vera-private/\n",
    "utf8",
  );
  const dataset = join(root, "datasets");
  const privateConfig = join(root, ".vera-private");
  const report = join(root, "reports/private/dataset-audit/latest.json");
  await Promise.all([
    mkdir(dataset, { recursive: true }),
    mkdir(privateConfig, { recursive: true }),
  ]);
  return { root, dataset, privateConfig, report };
}
