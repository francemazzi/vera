import { createHash } from "node:crypto";

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function assertValidString(value: string, location: string): void {
  if (LONE_SURROGATE.test(value)) {
    throw new TypeError(`${location} contains a lone Unicode surrogate`);
  }
}

function canonicalize(value: unknown, ancestors: ReadonlySet<object>, location: string): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);

  if (typeof value === "string") {
    assertValidString(value, location);
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${location} contains a non-finite number`);
    }

    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new TypeError(`${location} is not a JSON value`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${location} contains a circular reference`);
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (Array.isArray(value)) {
    const entries: string[] = [];

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${location} contains symbol keys`);
    }

    const unexpectedKeys = Object.keys(value).filter(
      (key) => !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length,
    );
    if (unexpectedKeys.length > 0) {
      throw new TypeError(`${location} contains non-index array properties`);
    }

    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor === undefined) {
        throw new TypeError(`${location}[${String(index)}] is a sparse array entry`);
      }

      if (!("value" in descriptor)) {
        throw new TypeError(`${location}[${String(index)}] must be a data property`);
      }

      entries.push(canonicalize(descriptor.value, nextAncestors, `${location}[${String(index)}]`));
    }

    return `[${entries.join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${location} must be a plain JSON object`);
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${location} contains symbol keys`);
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      assertValidString(key, `${location} key`);

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError(`${location}.${key} must be a data property`);
      }

      return `${JSON.stringify(key)}:${canonicalize(descriptor.value, nextAncestors, `${location}.${key}`)}`;
    });

  return `{${entries.join(",")}}`;
}

/** Canonicalizes a JSON value using deterministic property ordering and ECMAScript JSON numbers. */
export function canonicalizeJson(value: unknown): string {
  return canonicalize(value, new Set<object>(), "$");
}

/** Computes a lowercase SHA-256 digest from the exact input bytes. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Canonicalizes a JSON value as UTF-8 and computes its lowercase SHA-256 digest. */
export function sha256CanonicalJson(value: unknown): string {
  return sha256Bytes(new TextEncoder().encode(canonicalizeJson(value)));
}
