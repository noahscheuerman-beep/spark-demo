import { readFile } from "node:fs/promises";
import process from "node:process";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node check-novelty.mjs <manifest.json>");
  process.exit(2);
}

const records = JSON.parse(await readFile(path, "utf8"));
if (!Array.isArray(records)) throw new Error("Manifest must be a JSON array.");

const stop = new Set(["the", "a", "an", "and", "or", "to", "i", "it", "is", "my", "this", "that", "for", "of", "with"]);
const tokens = (value) => new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((token) => token.length > 1 && !stop.has(token)));
const similarity = (left, right) => {
  const a = tokens(left);
  const b = tokens(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
};

const errors = [];
const ids = new Set();
const variationKeys = new Set();
const openings = new Set();
const accountScenarios = new Set(["everyday", "faulty_charger", "delayed_replacement", "refund_pending"]);

for (const record of records) {
  if (!record.id || ids.has(record.id)) errors.push(`Duplicate or missing id: ${record.id ?? "<missing>"}`);
  if (!record.variationKey || variationKeys.has(record.variationKey)) errors.push(`Duplicate or missing variationKey: ${record.variationKey ?? "<missing>"}`);
  if (!Array.isArray(record.userTurns) || record.userTurns.length < 2 || record.userTurns.length > 4) errors.push(`${record.id}: userTurns must contain 2-4 turns`);
  if (!record.accountScenario && record.id?.startsWith("seed-")) errors.push(`${record.id}: accountScenario is required for generated scenarios`);
  if (record.accountScenario && !accountScenarios.has(record.accountScenario)) errors.push(`${record.id}: unsupported accountScenario ${record.accountScenario}`);
  const opening = record.userTurns?.[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  if (!opening || openings.has(opening)) errors.push(`${record.id}: duplicate or missing opening turn`);
  ids.add(record.id);
  variationKeys.add(record.variationKey);
  openings.add(opening);
}

for (let i = 0; i < records.length; i += 1) {
  for (let j = i + 1; j < records.length; j += 1) {
    if (records[i].domain !== records[j].domain) continue;
    const score = similarity(records[i].userTurns.join(" "), records[j].userTurns.join(" "));
    if (score >= 0.72) errors.push(`${records[i].id} and ${records[j].id} are too similar (${score.toFixed(2)})`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${records.length} scenarios with unique ids, variation keys, openings, and acceptable lexical distance.`);
