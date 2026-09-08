import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pre-renders the Spark customer portal", async () => {
  const html = await readFile(new URL("../.next/server/app/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Spark \| Your electric vehicle<\/title>/i);
  assert.match(html, /Your Spark One/);
  assert.match(html, /Spark Support/);
  assert.match(html, /My home charger keeps cutting out/);
  assert.match(html, /Start charging/);
  assert.match(html, /View orders/);
  assert.match(html, /Demo scenario/);
  assert.match(html, /Spark Shop/);
  assert.match(html, /Braintrust API key/);
  assert.match(html, /never stored by this demo/);
  assert.match(html, /Buy with credits/);
  assert.match(html, /Mobile Connector/);
  assert.doesNotMatch(html, /Find a charger|Open profile/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships a valid full scenario manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("../scenarios/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.length >= 300);
  assert.equal(new Set(manifest.map((item) => item.id)).size, manifest.length);
  assert.ok(manifest.every((item) => item.userTurns.length >= 2 && item.userTurns.length <= 4));
  assert.ok(manifest.some((item) => item.tags.includes("known-baseline-failure")));
});
