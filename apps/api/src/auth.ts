import { randomBytes, randomUUID } from "node:crypto";

import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import type { ActorRole } from "@vera/contracts";
import { sha256Bytes } from "@vera/contracts";
import type { LocalAccountRecord, VeraStorageRepository } from "@vera/storage";

import { ApiProblem } from "./errors.js";

const SESSION_BYTES = 32;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AuthenticatedAccount {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: ActorRole;
}

export interface AuthService {
  bootstrapAdmin(input: {
    readonly email: string;
    readonly displayName: string;
    readonly password: string;
    readonly role: ActorRole;
  }): Promise<AuthenticatedAccount>;
  createAccount(input: {
    readonly email: string;
    readonly displayName: string;
    readonly password: string;
    readonly role: ActorRole;
  }): Promise<AuthenticatedAccount>;
  login(input: {
    readonly email: string;
    readonly password: string;
    readonly now: string;
  }): Promise<{
    readonly token: string;
    readonly expiresAt: string;
    readonly account: AuthenticatedAccount;
  }>;
  authenticate(authorization: string | undefined, now: string): Promise<AuthenticatedAccount>;
}

function publicAccount(record: LocalAccountRecord): AuthenticatedAccount {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
  };
}

function tokenHash(token: string): string {
  return sha256Bytes(Buffer.from(token, "utf8"));
}

async function passwordHash(password: string): Promise<string> {
  return argonHash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export function createAuthService(repository: VeraStorageRepository): AuthService {
  return {
    async bootstrapAdmin(input) {
      if (input.role !== "ADMIN") {
        throw new ApiProblem(403, "Forbidden", "The initial account must have the ADMIN role");
      }
      const account = await repository.bootstrapAdminAccount({
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        passwordHash: await passwordHash(input.password),
        role: input.role,
        createdAt: new Date().toISOString(),
      });
      return publicAccount(account);
    },
    async createAccount(input) {
      const account = await repository.createAccount({
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        passwordHash: await passwordHash(input.password),
        role: input.role,
        createdAt: new Date().toISOString(),
      });
      return publicAccount(account);
    },
    async login(input) {
      const account = await repository.findAccountByEmail(input.email);
      if (account === null || account.disabled) {
        throw new ApiProblem(401, "Unauthorized", "Invalid credentials");
      }
      if (!(await argonVerify(account.passwordHash, input.password))) {
        throw new ApiProblem(401, "Unauthorized", "Invalid credentials");
      }
      const token = randomBytes(SESSION_BYTES).toString("base64url");
      const expiresAt = new Date(Date.parse(input.now) + DEFAULT_SESSION_TTL_MS).toISOString();
      await repository.createSession({
        id: randomUUID(),
        tokenHash: tokenHash(token),
        accountId: account.id,
        createdAt: input.now,
        expiresAt,
      });
      return { token, expiresAt, account: publicAccount(account) };
    },
    async authenticate(authorization, now) {
      const match = /^Bearer (?<token>[A-Za-z0-9_-]+)$/u.exec(authorization ?? "");
      if (match?.groups?.["token"] === undefined) {
        throw new ApiProblem(401, "Unauthorized", "Missing bearer token");
      }
      const session = await repository.findSessionByTokenHash(
        tokenHash(match.groups["token"]),
        now,
      );
      if (session === null) throw new ApiProblem(401, "Unauthorized", "Invalid or expired session");
      const account = await repository.findAccountById(session.accountId);
      if (account === null || account.disabled) {
        throw new ApiProblem(401, "Unauthorized", "Invalid or expired session");
      }
      return publicAccount(account);
    },
  };
}

export function assertRole(account: AuthenticatedAccount, allowed: readonly ActorRole[]): void {
  if (!allowed.includes(account.role)) {
    throw new ApiProblem(403, "Forbidden", "The account role cannot perform this action");
  }
}
