import type { Prisma } from "./generated/prisma/client.js";
import type { VeraPrismaClient } from "./prisma.js";

const SERIALIZABLE_ATTEMPTS = 3;

export function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "P2002"
  );
}

export function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "P2002" ||
      (error as { readonly code?: unknown }).code === "P2034")
  );
}

export async function runSerializableWithRetries<T>(
  prisma: VeraPrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt >= SERIALIZABLE_ATTEMPTS) throw error;
    }
  }
}
