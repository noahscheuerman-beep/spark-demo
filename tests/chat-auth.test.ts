import assert from "node:assert/strict";
import test from "node:test";
import { ChatAuthorizationError, resolveModelApiKey } from "../lib/spark/chat-auth";

const base = {
  source: "interactive" as const,
  authorizationHeader: null,
  internalTokenHeader: null,
  configuredInternalToken: "internal-secret",
  serverApiKey: "server-key",
  allowLocalInternal: false,
};

test("interactive chat requires and returns the visitor's bearer token", () => {
  assert.throws(
    () => resolveModelApiKey(base),
    (error: unknown) => error instanceof ChatAuthorizationError && error.code === "api_key_required",
  );
  assert.equal(
    resolveModelApiKey({ ...base, authorizationHeader: "Bearer visitor-key" }),
    "visitor-key",
  );
});

test("internal modes cannot be selected on a public deployment without its token", () => {
  assert.throws(
    () => resolveModelApiKey({ ...base, source: "playground" }),
    (error: unknown) => error instanceof ChatAuthorizationError && error.code === "internal_access_required",
  );
  assert.equal(
    resolveModelApiKey({ ...base, source: "playground", internalTokenHeader: "internal-secret" }),
    "server-key",
  );
});

test("local eval runners may use the configured server key without an internal token", () => {
  assert.equal(
    resolveModelApiKey({ ...base, source: "seed", allowLocalInternal: true }),
    "server-key",
  );
});
