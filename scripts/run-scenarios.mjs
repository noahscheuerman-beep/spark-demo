import { readFile } from "node:fs/promises";
import process from "node:process";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));

const source = args.get("source") || "daily";
const count = Number(args.get("count") || (source === "daily" ? 5 : 20));
const start = Number(args.get("start") || 0);
const baseUrl = args.get("base-url") || "http://localhost:3000";
const dryRun = args.get("dry-run") === "true";
const summaryOnly = args.get("summary-only") === "true";
const concurrency = Number(args.get("concurrency") || 1);
const scenarioId = args.get("scenario");
const promptVersion = args.get("prompt-version") || "baseline-v1";
const manifest = JSON.parse(await readFile(new URL("../scenarios/manifest.json", import.meta.url), "utf8"));

function accountScenarioFor(scenario) {
  if (scenario.accountScenario) return scenario.accountScenario;
  if (["replacement-order-status-013", "charging-and-order-status-020"].includes(scenario.id)) return "delayed_replacement";
  if (scenario.id === "refund-after-return-014") return "refund_pending";
  if (["charging-return-mixed-intent-001", "charging-intermittent-basic-002", "charging-red-light-escalation-003", "home-charging-slower-005", "scheduled-charge-missed-006"].includes(scenario.id)) return "faulty_charger";
  return "everyday";
}

function stableHash(value) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function dailyScenarios(day, requestedCount) {
  const ranked = manifest
    .map((scenario) => ({ scenario, rank: stableHash(`${day}:${scenario.id}`) }))
    .sort((left, right) => left.rank - right.rank || left.scenario.id.localeCompare(right.scenario.id));
  const selected = [];
  const selectedIds = new Set();
  const selectedDomains = new Set();

  for (const { scenario } of ranked) {
    if (selectedDomains.has(scenario.domain)) continue;
    selected.push(scenario);
    selectedIds.add(scenario.id);
    selectedDomains.add(scenario.domain);
    if (selected.length === requestedCount) return selected;
  }

  for (const { scenario } of ranked) {
    if (selectedIds.has(scenario.id)) continue;
    selected.push(scenario);
    if (selected.length === requestedCount) break;
  }
  return selected;
}

if (!Number.isInteger(count) || count < 1) throw new Error("--count must be a positive integer");
if (!Number.isInteger(start) || start < 0) throw new Error("--start must be a non-negative integer");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) throw new Error("--concurrency must be an integer between 1 and 5");
if (start + count > manifest.length && !scenarioId) throw new Error(`Requested scenarios ${start + 1}-${start + count}, but the manifest contains only ${manifest.length}. Expand it before running.`);

let selected;
if (scenarioId) {
  const scenario = manifest.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  selected = [scenario];
} else if (source === "daily") {
  const day = Math.floor(Date.now() / 86_400_000);
  selected = dailyScenarios(day, count);
} else {
  selected = manifest.slice(start, start + count);
}

if (dryRun) {
  console.log(JSON.stringify(selected.map((item) => ({ id: item.id, turns: item.userTurns.length, accountScenario: accountScenarioFor(item) })), null, 2));
  process.exit(0);
}

async function fetchJson(url, options, label, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const body = await response.json();
      if (response.ok) return { response, body };
      const message = body.error || response.statusText;
      if (response.status < 500 || attempt === maxAttempts) throw new Error(`${label}: ${message}`);
      lastError = new Error(`${label}: ${message}`);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** (attempt - 1)));
  }
  throw lastError;
}

async function runScenario(scenario) {
  const sessionId = `${source}-${scenario.id}-${crypto.randomUUID()}`;
  const accountScenario = accountScenarioFor(scenario);
  const { response: accountResponse } = await fetchJson(`${baseUrl}/api/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_scenario", scenario: accountScenario }),
  }, scenario.id);
  const accountCookie = accountResponse.headers.get("set-cookie")?.split(";")[0];
  if (!accountCookie) throw new Error(`${scenario.id}: account cookie was not created`);
  const turns = [];
  for (const message of scenario.userTurns) {
    const { body } = await fetchJson(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: accountCookie },
      body: JSON.stringify({ sessionId, message, source, scenarioId: scenario.id, promptVersion }),
    }, scenario.id, 1);
    turns.push({ user: message, assistant: body.content, route: body.route?.specialist, tools: body.toolsUsed });
  }
  return { scenarioId: scenario.id, accountScenario, sessionId, turns };
}

const results = new Array(selected.length);
const failures = [];
let cursor = 0;
let completed = 0;

async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= selected.length) return;
    const scenario = selected[index];
    try {
      results[index] = await runScenario(scenario);
    } catch (error) {
      failures.push({ scenarioId: scenario.id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      completed += 1;
      console.error(`[${completed}/${selected.length}] ${scenario.id} ${results[index] ? "complete" : "failed"}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));
const successful = results.filter(Boolean);
console.log(JSON.stringify({
  source,
  promptVersion,
  requested: selected.length,
  conversations: successful.length,
  failures,
  ...(summaryOnly ? {} : { results: successful }),
}, null, 2));
if (failures.length) process.exitCode = 1;
