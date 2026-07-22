import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parsePayload, toInputJson } from "../../src/payload.js";
import {
  isRetryableTransactionError,
  isUniqueConstraint,
  runSerializableWithRetries,
} from "../../src/transaction.js";
import type { VeraPrismaClient } from "../../src/index.js";

describe("storage transaction helpers", () => {
  it("identifies unique and retryable Prisma error codes conservatively", () => {
    expect(isUniqueConstraint({ code: "P2002" })).toBe(true);
    expect(isUniqueConstraint({ code: "P2034" })).toBe(false);
    expect(isUniqueConstraint(null)).toBe(false);
    expect(isUniqueConstraint("P2002")).toBe(false);

    expect(isRetryableTransactionError({ code: "P2002" })).toBe(true);
    expect(isRetryableTransactionError({ code: "P2034" })).toBe(true);
    expect(isRetryableTransactionError({ code: "P2025" })).toBe(false);
    expect(isRetryableTransactionError(undefined)).toBe(false);
  });

  it("runs serializable transactions and retries retryable failures", async () => {
    let attempts = 0;
    const prisma = {
      async $transaction<T>(
        operation: (transaction: { readonly marker: string }) => Promise<T>,
        options: { readonly isolationLevel?: string },
      ): Promise<T> {
        attempts += 1;
        expect(options.isolationLevel).toBe("Serializable");
        if (attempts < 3) throw { code: "P2034" };
        return operation({ marker: "transaction" });
      },
    } as unknown as VeraPrismaClient;

    await expect(
      runSerializableWithRetries(prisma, async (transaction) => {
        expect(transaction).toEqual({ marker: "transaction" });
        return "stored";
      }),
    ).resolves.toBe("stored");
    expect(attempts).toBe(3);
  });

  it("stops retrying after the configured attempts or on non-retryable errors", async () => {
    let retryableAttempts = 0;
    const retryable = {
      async $transaction(): Promise<never> {
        retryableAttempts += 1;
        throw { code: "P2034" };
      },
    } as unknown as VeraPrismaClient;

    await expect(runSerializableWithRetries(retryable, async () => "unreachable")).rejects.toEqual({
      code: "P2034",
    });
    expect(retryableAttempts).toBe(3);

    let nonRetryableAttempts = 0;
    const nonRetryable = {
      async $transaction(): Promise<never> {
        nonRetryableAttempts += 1;
        throw new Error("boom");
      },
    } as unknown as VeraPrismaClient;

    await expect(
      runSerializableWithRetries(nonRetryable, async () => "unreachable"),
    ).rejects.toThrow("boom");
    expect(nonRetryableAttempts).toBe(1);
  });
});

describe("storage payload helpers", () => {
  it("passes JSON values through to Prisma and validates payloads through Zod", () => {
    const payload = { ok: true, nested: { count: 1 } };
    expect(toInputJson(payload)).toBe(payload);
    expect(parsePayload(z.object({ ok: z.literal(true) }), payload)).toEqual({ ok: true });
    expect(() => parsePayload(z.object({ ok: z.literal(false) }), payload)).toThrow();
  });
});
