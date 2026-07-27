import { OAuth2Client } from "google-auth-library";

export interface TaskOidcAuthorizer {
  authorize(authorization: string | undefined): Promise<void>;
}

function readBearerToken(authorization: string | undefined): string {
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

/**
 * Accepts the shared Docker Compose bearer when LABEL_LOCAL_MODE=true.
 * Production continues to require a verified Cloud Tasks OIDC identity.
 */
export function createTaskOidcAuthorizer(options: {
  readonly audience: string;
  readonly expectedServiceAccountEmail: string;
  readonly client?: Pick<OAuth2Client, "verifyIdToken">;
  readonly localMode?: boolean;
  readonly localAuthToken?: string;
}): TaskOidcAuthorizer {
  const client = options.client ?? new OAuth2Client();
  const localMode = options.localMode === true || process.env["LABEL_LOCAL_MODE"] === "true";
  const localAuthToken = options.localAuthToken ?? process.env["LABEL_LOCAL_AUTH_TOKEN"] ?? "local-dev";
  return {
    async authorize(authorization) {
      const token = readBearerToken(authorization);
      if (!token) throw new Error("Missing Cloud Tasks OIDC token");
      if (localMode) {
        if (token !== localAuthToken) throw new Error("Unexpected local label auth token");
        return;
      }
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
