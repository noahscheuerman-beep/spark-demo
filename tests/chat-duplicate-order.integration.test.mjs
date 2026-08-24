import assert from "node:assert/strict";
import test from "node:test";

const BASE_URL = process.env.SPARK_TEST_BASE_URL || "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 80_000;
const TEST_TIMEOUT_MS = 300_000;

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

async function setupScenario(scenario) {
  const response = await fetchWithHardTimeout("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_scenario", scenario }),
  });
  const body = await readJson(response, `${scenario} setup`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, `${scenario} setup did not return the Spark account cookie`);
  return { body, cookie };
}

async function chat(cookie, sessionId, message, turn) {
  const response = await fetchWithHardTimeout("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      sessionId,
      message,
      source: "playground",
      scenarioId: "duplicate-order-regression",
      promptVersion: "story-v2",
    }),
  });
  return readJson(response, `chat turn ${turn}`);
}

async function getAccount(cookie) {
  const response = await fetchWithHardTimeout("/api/account", { headers: { Cookie: cookie } });
  return readJson(response, "account refresh");
}

test(
  "a visible duplicate order is canceled only after confirmation",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { body: setup, cookie } = await setupScenario("duplicate_order");
    assert.equal(setup.account.creditsCents, 40000);
    assert.deepEqual(
      setup.account.orders.filter((order) => order.status === "processing").map((order) => order.id),
      ["ORD-2212", "ORD-2211"],
    );

    const sessionId = `integration-visible-duplicate-${crypto.randomUUID()}`;
    const first = await chat(cookie, sessionId, "I placed the All-Weather Interior Mats order twice by mistake. Can you cancel the newer duplicate?", 1);
    assert.ok(first.toolsUsed.includes("get_pending_orders"), `expected pending-order lookup, saw ${first.toolsUsed}`);
    assert.ok(!first.toolsUsed.includes("cancel_pending_order"), "cancellation ran before confirmation");

    const second = await chat(cookie, sessionId, "Yes, cancel the newer mats order ORD-2212 and restore the Spark Credits.", 2);
    assert.ok(second.toolsUsed.includes("cancel_pending_order"), `expected cancellation tool, saw ${second.toolsUsed}`);

    const refreshed = await getAccount(cookie);
    assert.equal(refreshed.account.orders.find((order) => order.id === "ORD-2212")?.status, "canceled");
    assert.equal(refreshed.account.orders.find((order) => order.id === "ORD-2211")?.status, "processing");
    assert.equal(refreshed.account.creditsCents, 62500);
  },
);

test(
  "an unseen suspected duplicate is escalated without returning a delivered order",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { cookie } = await setupScenario("everyday");
    const sessionId = `integration-unseen-duplicate-${crypto.randomUUID()}`;

    const first = await chat(cookie, sessionId, "I think I accidentally placed the same accessory order twice. Can you cancel one?", 1);
    assert.ok(first.toolsUsed.includes("get_pending_orders"), `expected pending-order lookup, saw ${first.toolsUsed}`);
    assert.ok(!first.toolsUsed.includes("create_return_request"), "an unrelated return was created");

    const second = await chat(cookie, sessionId, "Only ORD-1842 is visible, so the second order may not have appeared yet.", 2);
    assert.ok(!second.toolsUsed.includes("check_return_eligibility"), "the delivered order was reframed as a return");
    assert.ok(!second.toolsUsed.includes("create_return_request"), "the delivered order was returned");

    const third = await chat(cookie, sessionId, "Yes, connect me with someone who can intercept the duplicate before it ships.", 3);
    assert.ok(third.toolsUsed.includes("escalate_to_human"), `expected urgent escalation, saw ${third.toolsUsed}`);
    assert.ok(!third.toolsUsed.includes("create_return_request"), "the delivered order was returned during escalation");
  },
);
