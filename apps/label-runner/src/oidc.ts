import { OAuth2Client } from "google-auth-library";

export interface TaskOidcAuthorizer {
  authorize(authorization: string | undefined): Promise<void>;
}

/** Development-only loopback authorizer. The caller must opt into this in
 * configuration; production construction continues to use Google OIDC. */
export function createLocalTaskAuthorizer(token: string): TaskOidcAuthorizer {
  return {
    async authorize(authorization) {
      await Promise.resolve();
      if (authorization !== `Bearer ${token}`) throw new Error("Invalid local label runner token");
    },
  };
}

export function createTaskOidcAuthorizer(options: {
  readonly audience: string;
  readonly expectedServiceAccountEmail: string;
  readonly client?: Pick<OAuth2Client, "verifyIdToken">;
}): TaskOidcAuthorizer {
  const client = options.client ?? new OAuth2Client();
  return {
    async authorize(authorization) {
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
      if (!token) throw new Error("Missing Cloud Tasks OIDC token");
      const ticket = await client.verifyIdToken({ idToken: token, audience: options.audience });
      const payload = ticket.getPayload();
      if (
        payload?.email !== options.expectedServiceAccountEmail ||
        payload.email_verified !== true
      ) {
        throw new Error("Unexpected Cloud Tasks OIDC identity");
      }
    },
  };
}
