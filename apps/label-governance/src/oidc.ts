import { OAuth2Client } from "google-auth-library";
import { timingSafeEqual } from "node:crypto";

/** Cloud Run IAM is the primary boundary; this validates its backend OIDC token too. */
export interface BackendOidcAuthorizer {
  authorize(authorization: string | undefined): Promise<void>;
}

/** Development-only loopback boundary. Cloud Run always uses OIDC above. */
export function createLocalBearerAuthorizer(token: string): BackendOidcAuthorizer {
  const expected = Buffer.from(token);
  if (expected.byteLength < 24) throw new Error("Local governance token is too short");
  return {
    async authorize(authorization) {
      await Promise.resolve();
      const actual = authorization?.startsWith("Bearer ")
        ? Buffer.from(authorization.slice("Bearer ".length))
        : Buffer.alloc(0);
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
        throw new Error("Invalid local governance token");
      }
    },
  };
}

export function createBackendOidcAuthorizer(options: {
  readonly audience: string;
  readonly expectedServiceAccountEmail?: string;
  readonly expectedServiceAccountEmails?: readonly string[];
  readonly client?: Pick<OAuth2Client, "verifyIdToken">;
}): BackendOidcAuthorizer {
  const client = options.client ?? new OAuth2Client();
  const expectedEmails = new Set(
    [options.expectedServiceAccountEmail, ...(options.expectedServiceAccountEmails ?? [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()),
  );
  if (expectedEmails.size === 0)
    throw new Error("At least one expected OIDC service account is required");
  return {
    async authorize(authorization) {
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
      if (!token) throw new Error("Missing SILTO backend OIDC token");
      const ticket = await client.verifyIdToken({ idToken: token, audience: options.audience });
      const payload = ticket.getPayload();
      if (
        payload?.email === undefined ||
        !expectedEmails.has(payload.email) ||
        payload.email_verified !== true
      ) {
        throw new Error("Unexpected SILTO backend OIDC identity");
      }
    },
  };
}
