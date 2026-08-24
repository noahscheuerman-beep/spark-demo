import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const BASE_URL = process.env.SPARK_TEST_BASE_URL || "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 80_000;
const TEST_TIMEOUT_MS = 240_000;
const SCENARIO_ID = "warranty-coverage-question-017";

const manifest = JSON.parse(
  readFileSync(new URL("../scenarios/manifest.json", import.meta.url), "utf8"),
);
const scenario = manifest.find((item) => item.id === SCENARIO_ID);

assert.ok(scenario, `Missing ${SCENARIO_ID} from scenarios/manifest.json`);
assert.equal(scenario.userTurns.length, 3, `${SCENARIO_ID} must keep its three-turn regression shape`);

async function fetchWithHardTimeout(path, init) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error(`${path} exceeded ${REQUEST_TIMEOUT_MS}ms`)),
    REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(`${BASE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJson(response, label) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    assert.fail(`${label} returned non-JSON ${response.status}: ${text.slice(0, 800)}`);
  }
  assert.notEqual(response.status, 500, `${label} returned Worker 500: ${text}`);
  assert.notEqual(response.status, 504, `${label} timed out: ${text}`);
  assert.ok(response.ok, `${label} returned ${response.status}: ${text}`);
  return body;
}

test(
  `${SCENARIO_ID} completes all three chat turns sequentially`,
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const accountResponse = await fetchWithHardTimeout("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_scenario", scenario: "everyday" }),
    });
    await readJson(accountResponse, "account setup");
    const accountCookie = accountResponse.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(accountCookie, "Account setup did not return the Spark account cookie");

    const sessionId = `integration-${SCENARIO_ID}-${crypto.randomUUID()}`;
    for (const [index, message] of scenario.userTurns.entries()) {
      const response = await fetchWithHardTimeout("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: accountCookie },
        body: JSON.stringify({
          sessionId,
          message,
          source: "playground",
          scenarioId: SCENARIO_ID,
          promptVersion: "improved-v1",
        }),
      });
      const body = await readJson(response, `chat turn ${index + 1}`);
      assert.equal(body.sessionId, sessionId, `chat turn ${index + 1} changed sessions`);
      assert.equal(typeof body.content, "string", `chat turn ${index + 1} returned no assistant content`);
      assert.ok(body.content.trim().length > 0, `chat turn ${index + 1} returned empty assistant content`);
    }
  },
);
