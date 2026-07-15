import { describe, expect, it } from "vitest";

import { canonicalizeJson, sha256Bytes, sha256CanonicalJson } from "../../src/index.js";

describe("sha256Bytes", () => {
  it.each([
    [new Uint8Array(), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    [
      new TextEncoder().encode("hello"),
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    ],
  ])("hashes the exact byte sequence", (bytes, expected) => {
    expect(sha256Bytes(bytes)).toBe(expected);
  });

  it("does not conflate distinct byte representations", () => {
    expect(sha256Bytes(new Uint8Array([0xc3, 0xa9]))).not.toBe(
      sha256Bytes(new Uint8Array([0x65, 0xcc, 0x81])),
    );
  });
});

describe("canonicalizeJson", () => {
  it("sorts object keys recursively while retaining array order", () => {
    expect(
      canonicalizeJson({ z: 3, nested: { beta: true, alpha: null }, items: [2, { b: 1, a: 0 }] }),
    ).toBe('{"items":[2,{"a":0,"b":1}],"nested":{"alpha":null,"beta":true},"z":3}');
  });

  it.each([
    [null, "null"],
    [true, "true"],
    ["line\nfeed", '"line\\nfeed"'],
    [-0, "0"],
    [1e30, "1e+30"],
  ])("uses JSON-compatible primitive serialization for %j", (value, expected) => {
    expect(canonicalizeJson(value)).toBe(expected);
  });

  it("accepts plain objects with a null prototype and repeated non-cyclic references", () => {
    const shared = { value: 1 };
    const dictionary = Object.create(null) as Record<string, unknown>;
    dictionary["right"] = shared;
    dictionary["left"] = shared;

    expect(canonicalizeJson(dictionary)).toBe('{"left":{"value":1},"right":{"value":1}}');
  });

  it.each([
    undefined,
    1n,
    Symbol("not-json"),
    () => undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    new Date("2026-01-01T00:00:00.000Z"),
    "\uD800",
  ])("rejects a value outside the JSON data model", (value) => {
    expect(() => canonicalizeJson(value)).toThrow(TypeError);
  });

  it("rejects invalid nested object data", () => {
    expect(() => canonicalizeJson({ value: undefined })).toThrow(TypeError);
    expect(() => canonicalizeJson({ "\uDC00": true })).toThrow(TypeError);
  });

  it("rejects circular references", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() => canonicalizeJson(circular)).toThrow(/circular/u);
  });

  it("rejects sparse arrays, extra array properties, and symbol keys", () => {
    const sparse = new Array<unknown>(1);
    const extended: unknown[] = [];
    Object.defineProperty(extended, "extra", { enumerable: true, value: 1 });
    const outOfRange: unknown[] = [];
    Object.defineProperty(outOfRange, "4294967295", { enumerable: true, value: 1 });
    const symbolArray: unknown[] = [];
    Object.defineProperty(symbolArray, Symbol("hidden"), { enumerable: true, value: 1 });
    const symbolKeyed = { value: 1 };
    Object.defineProperty(symbolKeyed, Symbol("hidden"), { enumerable: true, value: 2 });

    expect(() => canonicalizeJson(sparse)).toThrow(/sparse/u);
    expect(() => canonicalizeJson(extended)).toThrow(/non-index/u);
    expect(() => canonicalizeJson(outOfRange)).toThrow(/non-index/u);
    expect(() => canonicalizeJson(symbolArray)).toThrow(/symbol/u);
    expect(() => canonicalizeJson(symbolKeyed)).toThrow(/symbol/u);
  });

  it("rejects accessors without invoking them", () => {
    let accessed = false;
    const withAccessor = {};
    Object.defineProperty(withAccessor, "value", {
      enumerable: true,
      get: () => {
        accessed = true;
        return 1;
      },
    });

    expect(() => canonicalizeJson(withAccessor)).toThrow(/data property/u);
    expect(accessed).toBe(false);
  });

  it("rejects array accessors without invoking them", () => {
    let accessed = false;
    const withAccessor: unknown[] = [0];
    Object.defineProperty(withAccessor, 0, {
      enumerable: true,
      get: () => {
        accessed = true;
        return 1;
      },
    });

    expect(() => canonicalizeJson(withAccessor)).toThrow(/data property/u);
    expect(accessed).toBe(false);
  });
});

describe("sha256CanonicalJson", () => {
  it("matches a published digest for a stable canonical representation", () => {
    expect(sha256CanonicalJson({ b: 2, a: 1 })).toBe(
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });

  it("is insensitive to insertion order and sensitive to values", () => {
    expect(sha256CanonicalJson({ alpha: 1, beta: 2 })).toBe(
      sha256CanonicalJson({ beta: 2, alpha: 1 }),
    );
    expect(sha256CanonicalJson({ alpha: 1 })).not.toBe(sha256CanonicalJson({ alpha: 2 }));
  });
});
