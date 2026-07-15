import { describe, expect, it } from "vitest";

import {
  snapshotJsonValue,
  type JsonSnapshotLimits,
  type JsonSnapshotResult,
} from "../../src/json-snapshot.js";

const LIMITS: JsonSnapshotLimits = {
  maxDepth: 4,
  maxNodes: 20,
  maxCanonicalBytes: 1_000,
  rejectNegativeZero: true,
  rejectUnsafeIntegers: true,
};

function snapshot(value: unknown, overrides: Partial<JsonSnapshotLimits> = {}): JsonSnapshotResult {
  return snapshotJsonValue(value, { ...LIMITS, ...overrides });
}

describe("descriptor-only JSON snapshots", () => {
  it.each([null, true, false, "text", 0, 1.25])("detaches canonical scalar %j", (value) => {
    expect(snapshot(value)).toEqual({
      success: true,
      value,
      canonical: JSON.stringify(value),
    });
  });

  it("detaches nested arrays and null-prototype objects without invoking getters", () => {
    let getterCalls = 0;
    const target = { safe: [1, { nested: "value" }] };
    const input = new Proxy(target, {
      get(object, key): unknown {
        getterCalls += 1;
        return key === "safe" ? object.safe : undefined;
      },
    });
    const result = snapshot(input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.canonical).toBe('{"safe":[1,{"nested":"value"}]}');
    expect(Object.getPrototypeOf(result.value)).toBeNull();
    expect(getterCalls).toBe(0);
    target.safe[1] = { nested: "changed" };
    expect(result.canonical).toBe('{"safe":[1,{"nested":"value"}]}');
  });

  it.each([
    ["lone surrogate", "\uD800"],
    ["non-finite", Number.NaN],
    ["negative zero", -0],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["undefined", undefined],
    ["bigint", 1n],
  ])("rejects %s", (_label, value) => {
    expect(snapshot(value).success).toBe(false);
  });

  it("can explicitly preserve negative zero and unsafe integers for a non-hashing caller", () => {
    expect(snapshot(-0, { rejectNegativeZero: false, rejectUnsafeIntegers: false }).success).toBe(
      true,
    );
    expect(
      snapshot(Number.MAX_SAFE_INTEGER + 1, {
        rejectNegativeZero: false,
        rejectUnsafeIntegers: false,
      }).success,
    ).toBe(true);
  });

  it("rejects depth, node, and canonical byte budget overflow", () => {
    expect(snapshot({ nested: { value: true } }, { maxDepth: 1 }).success).toBe(false);
    expect(snapshot([true, false], { maxNodes: 2 }).success).toBe(false);
    expect(snapshot("12345", { maxCanonicalBytes: 3 }).success).toBe(false);
    expect(snapshot("12345", { maxCanonicalBytes: null }).success).toBe(true);
  });

  it("rejects cycles and shared references", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const shared = { value: true };
    expect(snapshot(cyclic).success).toBe(false);
    expect(snapshot({ left: shared, right: shared }).success).toBe(false);
  });

  it("rejects non-plain containers, symbols, sparse arrays, and extra array properties", () => {
    expect(snapshot(new Date()).success).toBe(false);
    expect(snapshot(Object.assign({}, { [Symbol("secret")]: true })).success).toBe(false);
    expect(snapshot(Object.assign([true], { [Symbol("secret")]: true })).success).toBe(false);
    expect(snapshot(Object.assign([true], { extra: true })).success).toBe(false);
    expect(snapshot(new Array(2)).success).toBe(false);
    expect(snapshot(new Array(21)).success).toBe(false);
    const nonStandard = [true];
    Object.setPrototypeOf(nonStandard, null);
    expect(snapshot(nonStandard).success).toBe(false);
  });

  it("rejects accessors, non-enumerable entries, and malformed keys", () => {
    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => true });
    expect(snapshot(accessor).success).toBe(false);

    const hidden = {};
    Object.defineProperty(hidden, "value", { enumerable: false, value: true });
    expect(snapshot(hidden).success).toBe(false);
    expect(snapshot({ ["\uD800"]: true }).success).toBe(false);

    const arrayEntry = [true];
    Object.defineProperty(arrayEntry, "0", { enumerable: false, value: true });
    expect(snapshot(arrayEntry).success).toBe(false);
  });

  it("converts throwing proxy traps into a validation failure", () => {
    const input = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("adversarial ownKeys trap");
        },
      },
    );

    expect(() => snapshot(input)).not.toThrow();
    expect(snapshot(input)).toEqual({
      success: false,
      issue: "Value could not be inspected as JSON",
    });
  });

  it("preserves prototype-like keys as inert own data", () => {
    const input = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    const result = snapshot(input);
    expect(result.success).toBe(true);
    if (
      !result.success ||
      result.value === null ||
      typeof result.value !== "object" ||
      Array.isArray(result.value)
    )
      return;
    const objectValue = result.value as Readonly<Record<string, unknown>>;
    expect(Object.getPrototypeOf(objectValue)).toBeNull();
    expect(objectValue["__proto__"]).toEqual({ polluted: true });
  });
});
