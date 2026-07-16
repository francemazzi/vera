import { describe, expect, it } from "vitest";

import { validateArtifactContent } from "../../src/formats.js";
import { minimalPng, minimalXlsx, storedZip } from "../helpers/fixtures.js";

describe("dataset artifact format validation", () => {
  it("validates PNG, JSON, JSONL, and XLSX from their bytes", () => {
    expect(validateArtifactContent(minimalPng(), ".png")).toMatchObject({
      detectedFormat: "PNG",
      issues: [],
    });
    expect(validateArtifactContent(Buffer.from('{"ok":true}'), ".json")).toMatchObject({
      detectedFormat: "JSON",
      parsedJson: { ok: true },
      issues: [],
    });
    expect(validateArtifactContent(Buffer.from('{"row":1}\n{"row":2}\n'), ".jsonl")).toMatchObject({
      detectedFormat: "JSONL",
      parsedJson: [{ row: 1 }, { row: 2 }],
      issues: [],
    });
    expect(validateArtifactContent(minimalXlsx(), ".xlsx")).toMatchObject({
      detectedFormat: "XLSX",
      issues: [],
    });
  });

  it("accepts the valid JSON literal null in JSON and JSONL", () => {
    expect(validateArtifactContent(Buffer.from("null"), ".json")).toMatchObject({
      detectedFormat: "JSON",
      parsedJson: null,
      issues: [],
    });
    expect(validateArtifactContent(Buffer.from("null\n"), ".jsonl")).toMatchObject({
      detectedFormat: "JSONL",
      parsedJson: [null],
      issues: [],
    });
  });

  it("detects content/extension mismatches without treating valid content as invalid", () => {
    const result = validateArtifactContent(Buffer.from('{"ok":true}'), ".png");

    expect(result.detectedFormat).toBe("JSON");
    expect(result.issues).toEqual([{ code: "EXTENSION_CONTENT_MISMATCH", severity: "WARNING" }]);

    expect(validateArtifactContent(minimalPng(), ".img")).toMatchObject({
      detectedFormat: "PNG",
      issues: [{ code: "EXTENSION_CONTENT_MISMATCH", severity: "WARNING" }],
    });
  });

  it("reports malformed structured files with controlled issue codes", () => {
    const badPng = Buffer.from(minimalPng());
    badPng[badPng.length - 1] = (badPng[badPng.length - 1] ?? 0) ^ 0xff;

    expect(validateArtifactContent(badPng, ".png").issues).toContainEqual({
      code: "INVALID_PNG",
      severity: "ERROR",
    });
    expect(
      validateArtifactContent(Buffer.from('{"private":"unterminated"'), ".json").issues,
    ).toContainEqual({
      code: "INVALID_JSON",
      severity: "ERROR",
    });
    expect(
      validateArtifactContent(Buffer.from('{"ok":1}\nnot-json'), ".jsonl").issues,
    ).toContainEqual({
      code: "INVALID_JSONL",
      severity: "ERROR",
    });
    expect(validateArtifactContent(Buffer.from("not a workbook"), ".xlsx").issues).toContainEqual({
      code: "INVALID_XLSX",
      severity: "ERROR",
    });
    expect(validateArtifactContent(Buffer.from([0xff, 0xfe, 0xfd]), ".json").issues).toContainEqual(
      {
        code: "INVALID_JSON",
        severity: "ERROR",
      },
    );
  });

  it("rejects bounded-ZIP violations and traversal entries", () => {
    const bomb = Buffer.from(minimalXlsx());
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(33 * 1024 * 1024, central + 24);
    const traversal = storedZip([
      { name: "[Content_Types].xml", content: "spreadsheetml" },
      { name: "../xl/workbook.xml", content: "<workbook/>" },
    ]);

    expect(validateArtifactContent(bomb, ".xlsx").issues).toContainEqual({
      code: "INVALID_XLSX",
      severity: "ERROR",
    });
    expect(validateArtifactContent(traversal, ".xlsx").issues).toContainEqual({
      code: "INVALID_XLSX",
      severity: "ERROR",
    });
  });

  it("rejects malformed ZIP metadata, ratios, local headers, and deflate streams", () => {
    const noDirectory = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const multipleDisks = Buffer.from(minimalXlsx());
    const multipleDisksEocd = multipleDisks.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    multipleDisks.writeUInt16LE(1, multipleDisksEocd + 4);

    const excessiveRatio = Buffer.from(minimalXlsx());
    const ratioCentral = excessiveRatio.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const compressedBytes = excessiveRatio.readUInt32LE(ratioCentral + 20);
    excessiveRatio.writeUInt32LE(compressedBytes * 201, ratioCentral + 24);

    const localMismatch = Buffer.from(minimalXlsx());
    localMismatch.writeUInt16LE(8, 8);

    const invalidDeflate = Buffer.from(minimalXlsx());
    const deflateCentral = invalidDeflate.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    invalidDeflate.writeUInt16LE(8, 8);
    invalidDeflate.writeUInt16LE(8, deflateCentral + 10);

    for (const workbook of [
      noDirectory,
      multipleDisks,
      excessiveRatio,
      localMismatch,
      invalidDeflate,
    ]) {
      expect(validateArtifactContent(workbook, ".xlsx").issues).toContainEqual({
        code: "INVALID_XLSX",
        severity: "ERROR",
      });
    }

    const workbookWithDirectory = storedZip([
      { name: "xl/", content: "" },
      { name: "[Content_Types].xml", content: "spreadsheetml" },
      { name: "xl/workbook.xml", content: "<workbook></workbook>" },
    ]);
    expect(validateArtifactContent(workbookWithDirectory, ".xlsx").issues).toEqual([]);
  });

  it("classifies unsupported bytes as auxiliary with no content leakage", () => {
    const privateValue = "PRIVATE_VALUE_MUST_NOT_LEAK";
    const result = validateArtifactContent(Buffer.from(privateValue), ".txt");

    expect(result).toMatchObject({
      detectedFormat: "AUXILIARY",
      issues: [{ code: "AUXILIARY_FORMAT", severity: "WARNING" }],
    });
    expect(JSON.stringify(result)).not.toContain(privateValue);
  });
});
