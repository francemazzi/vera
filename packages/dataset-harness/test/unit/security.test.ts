import { execFileSync } from "node:child_process";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertIgnoredInput,
  assertIgnoredOutput,
  readIgnoredPrivateJson,
  resolveGitRoot,
} from "../../src/security.js";
import { makeTestRepository, type TestRepository } from "../helpers/fixtures.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<TestRepository> {
  const value = await makeTestRepository();
  roots.push(value.root);
  return value;
}

describe("dataset audit filesystem privacy guards", () => {
  it("discovers Git roots and reads only bounded, ignored, untracked JSON", async () => {
    const fixture = await repository();
    const config = join(fixture.privateConfig, "projection.json");
    await writeFile(config, '{"safe":true}');

    expect(await resolveGitRoot(fixture.privateConfig)).toBe(await resolveGitRoot(fixture.root));
    await expect(readIgnoredPrivateJson(config, { gitRoot: fixture.root })).resolves.toEqual({
      safe: true,
    });
    await expect(
      readIgnoredPrivateJson(config, { gitRoot: fixture.root, maxBytes: 2 }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });

    await writeFile(config, "PRIVATE_MALFORMED_JSON");
    await expect(readIgnoredPrivateJson(config, { gitRoot: fixture.root })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("rejects private config symlinks, path escapes, non-ignored files, and tracked files", async () => {
    const fixture = await repository();
    const target = join(fixture.privateConfig, "target.json");
    const link = join(fixture.privateConfig, "link.json");
    await writeFile(target, "{}");
    await symlink(target, link);
    await expect(readIgnoredPrivateJson(link, { gitRoot: fixture.root })).rejects.toMatchObject({
      code: "SYMLINK_REJECTED",
    });
    await expect(
      readIgnoredPrivateJson(target, { gitRoot: fixture.dataset }),
    ).rejects.toMatchObject({
      code: "PATH_ESCAPE",
    });

    const publicConfig = join(fixture.root, "projection.json");
    await writeFile(publicConfig, "{}");
    await expect(
      readIgnoredPrivateJson(publicConfig, { gitRoot: fixture.root }),
    ).rejects.toMatchObject({ code: "INPUT_NOT_IGNORED" });

    execFileSync("git", ["-C", fixture.root, "add", "--force", target]);
    await expect(readIgnoredPrivateJson(target, { gitRoot: fixture.root })).rejects.toMatchObject({
      code: "PRIVACY_GUARD_FAILED",
    });
  });

  it("rejects invalid, escaped, symlinked, non-ignored, and tracked input roots", async () => {
    const fixture = await repository();
    const data = join(fixture.dataset, "data.json");
    await writeFile(data, "null");
    await expect(assertIgnoredInput(fixture.dataset)).resolves.toMatchObject({
      root: await resolveGitRoot(fixture.dataset).then((root) => join(root, "datasets")),
    });
    await expect(assertIgnoredInput(data, fixture.root)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    await expect(
      assertIgnoredInput(join(fixture.root, "absent"), fixture.root),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    const rootLink = join(fixture.root, "dataset-link");
    await symlink(fixture.dataset, rootLink);
    await expect(assertIgnoredInput(rootLink, fixture.root)).rejects.toMatchObject({
      code: "SYMLINK_REJECTED",
    });
    await expect(assertIgnoredInput(fixture.dataset, fixture.privateConfig)).rejects.toMatchObject({
      code: "PATH_ESCAPE",
    });

    const publicDirectory = join(fixture.root, "public-data");
    await mkdir(publicDirectory);
    await expect(assertIgnoredInput(publicDirectory, fixture.root)).rejects.toMatchObject({
      code: "INPUT_NOT_IGNORED",
    });
    execFileSync("git", ["-C", fixture.root, "add", "--force", data]);
    await expect(assertIgnoredInput(fixture.dataset, fixture.root)).rejects.toMatchObject({
      code: "PRIVACY_GUARD_FAILED",
    });
  });

  it("protects prospective output paths from escapes, symlink segments, and tracking", async () => {
    const fixture = await repository();
    await expect(
      assertIgnoredOutput(join(fixture.privateConfig, "report.json"), fixture.dataset),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });

    const symlinkedParent = join(fixture.root, "reports/private/link");
    await mkdir(join(fixture.root, "reports/private"), { recursive: true });
    await symlink(fixture.dataset, symlinkedParent);
    await expect(
      assertIgnoredOutput(join(symlinkedParent, "report.json"), fixture.root),
    ).rejects.toMatchObject({ code: "SYMLINK_REJECTED" });

    await writeFile(fixture.report, "{}", { flag: "a" }).catch(async () => {
      await mkdir(join(fixture.root, "reports/private/dataset-audit"), { recursive: true });
      await writeFile(fixture.report, "{}");
    });
    execFileSync("git", ["-C", fixture.root, "add", "--force", fixture.report]);
    await expect(assertIgnoredOutput(fixture.report, fixture.root)).rejects.toMatchObject({
      code: "PRIVACY_GUARD_FAILED",
    });
  });

  it("maps Git command failures to a controlled fatal code", async () => {
    const fixture = await repository();
    await expect(resolveGitRoot(join(fixture.root, "absent"))).rejects.toMatchObject({
      code: "GIT_CHECK_FAILED",
    });
  });
});
