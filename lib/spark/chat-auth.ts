import { timingSafeEqual } from "node:crypto";

export type ChatSource = "interactive" | "seed" | "daily" | "playground";

export class ChatAuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 503,
    readonly code: "internal_access_required" | "configuration_required",
  ) {
    super(message);
    this.name = "ChatAuthorizationError";
  }
}

function secretsMatch(provided: string | null, configured: string) {
  if (!provided || !configured) return false;
  const providedBytes = Buffer.from(provided);
  const configuredBytes = Buffer.from(configured);
  return providedBytes.length === configuredBytes.length
    && timingSafeEqual(providedBytes, configuredBytes);
}

export function resolveModelApiKey(options: {
  source: ChatSource;
  internalTokenHeader: string | null;
  configuredInternalToken: string;
  serverApiKey: string;
  allowLocalInternal: boolean;
}) {
  if (options.source === "interactive") {
    if (!options.serverApiKey) {
      throw new ChatAuthorizationError(
        "Spark chat is not configured with a server API key.",
        503,
        "configuration_required",
      );
    }
    return options.serverApiKey;
  }

  const validInternalToken = secretsMatch(options.internalTokenHeader, options.configuredInternalToken);
  if (!options.allowLocalInternal && !validInternalToken) {
    throw new ChatAuthorizationError(
      "This chat mode is available only to Spark's internal eval runners.",
      403,
      "internal_access_required",
    );
  }
  if (!options.serverApiKey) {
    throw new ChatAuthorizationError(
      "BRAINTRUST_API_KEY is required for internal eval runs.",
      503,
      "configuration_required",
    );
  }
  return options.serverApiKey;
}
