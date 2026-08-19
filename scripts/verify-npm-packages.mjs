import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import console from "node:console";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const EXPECTED_PREPACK =
  "node ../../scripts/require-pnpm-pack.mjs && pnpm run clean && pnpm run build";

const EXPECTED_EXPORTS = {
  ".": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  },
};

const EXPECTED_SUMMARY = {
  aggregateOutcome: "REVIEW",
  findings: [
    {
      ruleId: "00000000-0000-4000-8000-000000000001",
      outcome: "REVIEW",
    },
  ],
};

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, stdout, stderr].filter(Boolean).join("\n"),
      { cause: error },
    );
  }
}

function decodeTarString(buffer) {
  const nullIndex = buffer.indexOf(0);
  return buffer
    .subarray(0, nullIndex === -1 ? buffer.length : nullIndex)
    .toString("utf8")
    .trim();
}

function parseTarNumber(buffer) {
  const value = decodeTarString(buffer).replace(/^0+/, "");
  return value === "" ? 0 : Number.parseInt(value, 8);
}

function parsePaxPath(buffer) {
  let offset = 0;
  let path;
  while (offset < buffer.length) {
    const separator = buffer.indexOf(0x20, offset);
    if (separator === -1) break;
    const length = Number.parseInt(buffer.toString("ascii", offset, separator), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = buffer.toString("utf8", separator + 1, offset + length - 1);
    const equals = record.indexOf("=");
    if (equals !== -1 && record.slice(0, equals) === "path") path = record.slice(equals + 1);
    offset += length;
  }
  return path;
}

async function readTarball(archivePath) {
  const tar = await gunzipAsync(await readFile(archivePath));
  const entries = new Map();
  let offset = 0;
  let pendingPath;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = decodeTarString(header.subarray(0, 100));
    const prefix = decodeTarString(header.subarray(345, 500));
    const headerPath = prefix === "" ? name : `${prefix}/${name}`;
    const size = parseTarNumber(header.subarray(124, 136));
    assert(Number.isSafeInteger(size) && size >= 0, `Invalid tar entry size for ${headerPath}`);

    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    assert(dataEnd <= tar.length, `Truncated tar entry: ${headerPath}`);
    const data = tar.subarray(dataStart, dataEnd);

    if (type === "L") {
      pendingPath = decodeTarString(data);
    } else if (type === "x") {
      pendingPath = parsePaxPath(data) ?? pendingPath;
    } else if (type === "\0" || type === "0" || type === "7") {
      const path = pendingPath ?? headerPath;
      assert(path.startsWith("package/"), `Unexpected tar root: ${path}`);
      assert(!path.split("/").includes(".."), `Unsafe tar path: ${path}`);
      assert(!entries.has(path), `Duplicate tar entry: ${path}`);
      entries.set(path, Buffer.from(data));
      pendingPath = undefined;
    } else if (type !== "5") {
      throw new Error(`Unsupported tar entry type ${JSON.stringify(type)} for ${headerPath}`);
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

async function assertSourceManifest(packageDirectory, expectedName) {
  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  assert.equal(manifest.name, expectedName);
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.private, undefined, `${expectedName} must be publishable`);
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.engines.node, ">=22.22.1 <23");
  assert.equal(manifest.types, "./src/index.ts");
  assert.equal(manifest.exports["."].types, "./src/index.ts");
  assert.equal(manifest.exports["."].development, "./src/index.ts");
  assert.equal(manifest.scripts.prepack, EXPECTED_PREPACK);
  assert.deepEqual(manifest.files, ["dist", "README.md", "LICENSE"]);
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.publishConfig.types, "./dist/index.d.ts");
  assert.deepEqual(manifest.publishConfig.exports, EXPECTED_EXPORTS);
  assert.deepEqual(Object.keys(manifest.exports), ["."], `${expectedName} exposes a deep import`);

  if (expectedName === "@vera/rules-core") {
    assert.equal(manifest.dependencies["@vera/contracts"], "workspace:0.2.0");
  }
}

async function packPackage(packageDirectory, destination) {
  const before = new Set((await readdir(destination)).filter((file) => file.endsWith(".tgz")));
  await run(pnpm, ["pack", "--pack-destination", destination], { cwd: packageDirectory });
  const created = (await readdir(destination)).filter(
    (file) => file.endsWith(".tgz") && !before.has(file),
  );
  assert.equal(created.length, 1, `Expected one tarball from ${packageDirectory}`);
  return join(destination, created[0]);
}

async function assertNativeNpmPackRejected(packageDirectory) {
  try {
    await execFileAsync(npm, ["pack", "--dry-run", "--ignore-scripts=false"], {
      cwd: packageDirectory,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    assert.match(`${stdout}\n${stderr}`, /devono essere preparati e pubblicati con pnpm/u);
    return;
  }

  throw new Error(`Native npm pack unexpectedly succeeded in ${packageDirectory}`);
}

async function assertPackedPackage(archivePath, expectedName, rootLicense) {
  const entries = await readTarball(archivePath);
  const required = [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
  ];
  for (const path of required) assert(entries.has(path), `${expectedName} is missing ${path}`);

  for (const path of entries.keys()) {
    const allowed =
      path === "package/package.json" ||
      path === "package/README.md" ||
      path === "package/LICENSE" ||
      path.startsWith("package/dist/");
    assert(allowed, `${expectedName} contains a file outside the allowlist: ${path}`);

    const segments = path.split("/");
    assert(!segments.includes("src"), `${expectedName} contains source files: ${path}`);
    assert(
      !segments.includes("test") && !segments.includes("tests"),
      `${expectedName} contains tests`,
    );
    assert(
      !segments.some((segment) => segment.startsWith("tsconfig")),
      `${expectedName} contains tsconfig`,
    );

    const content = entries.get(path);
    assert(content !== undefined);
    assert(!content.includes("workspace:"), `${expectedName} retains workspace: in ${path}`);
    assert(!content.includes("catalog:"), `${expectedName} retains catalog: in ${path}`);
  }

  assert.deepEqual(entries.get("package/LICENSE"), rootLicense, `${expectedName} license differs`);
  assert((entries.get("package/README.md")?.length ?? 0) > 100, `${expectedName} README is empty`);

  const manifest = JSON.parse(entries.get("package/package.json").toString("utf8"));
  assert.equal(manifest.name, expectedName);
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.sideEffects, false);
  assert.equal(manifest.engines.node, ">=22.22.1 <23");
  assert.equal(manifest.types, "./dist/index.d.ts");
  assert.deepEqual(manifest.exports, EXPECTED_EXPORTS);
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  assert.deepEqual(manifest.publishConfig, { access: "public" });

  if (expectedName === "@vera/rules-core") {
    assert.equal(manifest.dependencies["@vera/contracts"], "0.2.0");
  }
}

function assertSupportedNode() {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  assert(
    major === 22 && (minor > 22 || (minor === 22 && patch >= 1)),
    `npm verification requires Node >=22.22.1 <23; received ${process.versions.node}`,
  );
}

async function verifyConsumerProject(projectDirectory, contractsArchive, rulesCoreArchive) {
  await mkdir(join(projectDirectory, "src"), { recursive: true });
  await writeFile(
    join(projectDirectory, "package.json"),
    `${JSON.stringify({ name: "vera-npm-consumer", private: true, type: "module" }, null, 2)}\n`,
  );

  await run(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      contractsArchive,
      rulesCoreArchive,
    ],
    { cwd: projectDirectory },
  );

  const exampleSource = join(repoRoot, "examples", "npm-integration", "src");
  await copyFile(join(exampleSource, "index.ts"), join(projectDirectory, "src", "index.ts"));
  await copyFile(
    join(exampleSource, "synthetic-rule-pack.ts"),
    join(projectDirectory, "src", "synthetic-rule-pack.ts"),
  );
  await writeFile(
    join(projectDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          lib: ["ES2023", "DOM"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
          verbatimModuleSyntax: true,
          types: [],
          rootDir: "src",
          outDir: "dist",
          noEmitOnError: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    )}\n`,
  );

  const typescriptBin = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await run(process.execPath, [typescriptBin, "-p", "tsconfig.json"], { cwd: projectDirectory });
  const { stdout } = await run(process.execPath, [join("dist", "index.js")], {
    cwd: projectDirectory,
  });
  assert.deepEqual(JSON.parse(stdout), EXPECTED_SUMMARY);

  const deepImportProbe = [
    'import("@vera/contracts/dist/index.js")',
    ".then(() => process.exit(1))",
    '.catch((error) => { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error; });',
  ].join("");
  await run(process.execPath, ["--input-type=module", "--eval", deepImportProbe], {
    cwd: projectDirectory,
  });
}

async function main() {
  assertSupportedNode();
  const contractsDirectory = join(repoRoot, "packages", "contracts");
  const rulesCoreDirectory = join(repoRoot, "packages", "rules-core");
  const rootLicense = await readFile(join(repoRoot, "LICENSE"));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "vera-npm-verify-"));

  try {
    await assertSourceManifest(contractsDirectory, "@vera/contracts");
    await assertSourceManifest(rulesCoreDirectory, "@vera/rules-core");
    console.log("✓ manifest sorgente pronti per il rilascio");

    await assertNativeNpmPackRejected(contractsDirectory);
    await assertNativeNpmPackRejected(rulesCoreDirectory);
    console.log("✓ npm pack nativo bloccato; il percorso di rilascio richiede pnpm");

    const packDirectory = join(temporaryRoot, "packs");
    await mkdir(packDirectory);
    const contractsArchive = await packPackage(contractsDirectory, packDirectory);
    const rulesCoreArchive = await packPackage(rulesCoreDirectory, packDirectory);
    await assertPackedPackage(contractsArchive, "@vera/contracts", rootLicense);
    await assertPackedPackage(rulesCoreArchive, "@vera/rules-core", rootLicense);
    console.log("✓ tarball limitati a dist, README, LICENSE e package.json");

    await verifyConsumerProject(
      join(temporaryRoot, "consumer"),
      contractsArchive,
      rulesCoreArchive,
    );
    console.log(`✓ installazione npm, typecheck ed esempio su Node ${process.versions.node}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
