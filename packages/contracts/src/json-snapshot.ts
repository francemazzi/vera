import { types as nodeUtilTypes } from "node:util";

import { canonicalizeJson, type JsonValue } from "./hash.js";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/u;

export interface JsonSnapshotLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxCanonicalBytes: number | null;
  readonly rejectNegativeZero: boolean;
  readonly rejectUnsafeIntegers: boolean;
}

export type JsonSnapshotResult =
  | { readonly success: true; readonly value: JsonValue; readonly canonical: string }
  | { readonly success: false; readonly issue: string };

interface SnapshotTask {
  readonly source: unknown;
  readonly depth: number;
  readonly assign: (value: JsonValue) => void;
}

/**
 * Takes a detached JSON snapshot from data-property descriptors only. The original value is never
 * read through ordinary property access, so proxies, inherited values, and accessors cannot change
 * what later validation sees after the limits have been checked.
 */
export function snapshotJsonValue(input: unknown, limits: JsonSnapshotLimits): JsonSnapshotResult {
  try {
    return snapshotJsonValueUnchecked(input, limits);
  } catch {
    return { success: false, issue: "Value could not be inspected as JSON" };
  }
}

function snapshotJsonValueUnchecked(
  input: unknown,
  limits: JsonSnapshotLimits,
): JsonSnapshotResult {
  let root: JsonValue | undefined;
  let nodes = 0;
  const seen = new WeakSet<object>();
  const stack: SnapshotTask[] = [
    {
      source: input,
      depth: 0,
      assign: (value) => {
        root = value;
      },
    },
  ];

  while (stack.length > 0) {
    const task = stack.pop();
    /* v8 ignore next -- the loop condition guarantees a populated stack */
    if (task === undefined) break;
    nodes += 1;
    if (nodes > limits.maxNodes) return { success: false, issue: "JSON node limit exceeded" };
    if (task.depth > limits.maxDepth) {
      return { success: false, issue: "JSON depth limit exceeded" };
    }

    const source = task.source;
    if (source === null || typeof source === "boolean") {
      task.assign(source);
      continue;
    }
    if (typeof source === "string") {
      if (LONE_SURROGATE.test(source)) {
        return { success: false, issue: "Lone Unicode surrogate is forbidden" };
      }
      task.assign(source);
      continue;
    }
    if (typeof source === "number") {
      if (!Number.isFinite(source)) {
        return { success: false, issue: "Non-finite JSON numbers are forbidden" };
      }
      if (limits.rejectNegativeZero && Object.is(source, -0)) {
        return { success: false, issue: "Negative-zero JSON numbers are forbidden" };
      }
      if (
        limits.rejectUnsafeIntegers &&
        Number.isInteger(source) &&
        !Number.isSafeInteger(source)
      ) {
        return { success: false, issue: "Unsafe integral JSON numbers are forbidden" };
      }
      task.assign(source);
      continue;
    }
    if (typeof source !== "object") {
      return { success: false, issue: "Value is not JSON" };
    }
    if (nodeUtilTypes.isProxy(source)) {
      return { success: false, issue: "Proxy objects are forbidden" };
    }
    if (seen.has(source)) {
      return { success: false, issue: "Cycles and shared object references are forbidden" };
    }
    seen.add(source);

    const prototype = Object.getPrototypeOf(source) as object | null;
    const ownKeys = Reflect.ownKeys(source);
    if (Array.isArray(source)) {
      if (prototype !== Array.prototype) {
        return { success: false, issue: "Non-standard arrays are forbidden" };
      }
      if (ownKeys.some((key) => typeof key === "symbol")) {
        return { success: false, issue: "Symbol keys are forbidden" };
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(source, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > limits.maxNodes
      ) {
        return { success: false, issue: "Invalid array length" };
      }
      const length = lengthDescriptor.value as number;
      const stringKeys = ownKeys.filter((key): key is string => typeof key === "string");
      if (
        stringKeys.length !== length + 1 ||
        !stringKeys.includes("length") ||
        stringKeys.some(
          (key) => key !== "length" && (!ARRAY_INDEX.test(key) || Number(key) >= length),
        )
      ) {
        return { success: false, issue: "Sparse arrays and array properties are forbidden" };
      }

      const target: JsonValue[] = new Array<JsonValue>(length);
      task.assign(target);
      for (let index = length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return { success: false, issue: "Array entries must be enumerable data properties" };
        }
        stack.push({
          source: descriptor.value,
          depth: task.depth + 1,
          assign: (value) => {
            target[index] = value;
          },
        });
      }
      continue;
    }

    if (prototype !== Object.prototype && prototype !== null) {
      return { success: false, issue: "Non-plain objects are forbidden" };
    }
    if (ownKeys.some((key) => typeof key === "symbol")) {
      return { success: false, issue: "Symbol keys are forbidden" };
    }

    const target = Object.create(null) as Record<string, JsonValue>;
    task.assign(target);
    for (const key of ownKeys as string[]) {
      if (LONE_SURROGATE.test(key)) {
        return { success: false, issue: "Lone Unicode surrogate in key is forbidden" };
      }
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return { success: false, issue: "Object entries must be enumerable data properties" };
      }
      stack.push({
        source: descriptor.value,
        depth: task.depth + 1,
        assign: (value) => {
          Object.defineProperty(target, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        },
      });
    }
  }

  /* v8 ignore next -- every successful task assigns the root exactly once */
  if (root === undefined) return { success: false, issue: "Value is not JSON" };
  try {
    const canonical = canonicalizeJson(root);
    if (
      limits.maxCanonicalBytes !== null &&
      new TextEncoder().encode(canonical).byteLength > limits.maxCanonicalBytes
    ) {
      return { success: false, issue: "Canonical JSON byte limit exceeded" };
    }
    return { success: true, value: root, canonical };
  } catch {
    /* v8 ignore next -- defensive boundary if canonicalization gains stricter invariants */
    return { success: false, issue: "Value is not canonicalizable JSON" };
  }
}
