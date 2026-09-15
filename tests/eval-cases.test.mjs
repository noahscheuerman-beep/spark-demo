import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { selectEvalScenarios, assertEvalCaseCount } from "../scripts/eval-cases.mjs";

const manifest = JSON.parse(await readFile(new URL("../scenarios/manifest.json", import.meta.url)));
test("310 seed scenarios produce only 20 pilot cases", () => {
  assert.equal(manifest.length, 310);
  const cases = selectEvalScenarios(manifest, "pilot");
  assert.equal(cases.length, 20);
  assert.deepEqual(cases, manifest.slice(0, 20));
});
test("Loom stays at ten cases", () => {
  assert.equal(selectEvalScenarios(manifest, "loom").length, 10);
});
test("reject oversized or empty experiments and incomplete suites", () => {
  for (const count of [0, 26, 310]) assert.throws(() => assertEvalCaseCount(Array(count)), /1–25/);
  assert.doesNotThrow(() => assertEvalCaseCount(Array(25)));
  assert.throws(() => selectEvalScenarios(manifest.slice(0, 10), "pilot"), /exactly 20/);
});
test("preview explains two experiments or one without credentials or network", () => {
  for (const [args, expected] of [[[], 2], [["--only=improved"], 1]]) {
    const output = execFileSync(process.execPath, ["scripts/run-pilot-evals.mjs", "--dry-run=true", ...args], {
      cwd: new URL("../", import.meta.url), env: { PATH: process.env.PATH }, encoding: "utf8",
    });
    assert.match(output, new RegExp(`${expected} experiment\\(s\\), 20 cases each`));
  }
});

test("runner excludes existing dataset rows from both actual Eval calls", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "spark-eval-test-"));
  try {
    const hook = join(dir, "mock.mjs");
    await writeFile(hook, `
      import { registerHooks } from "node:module";
      const braintrust = \`
        import assert from "node:assert/strict";
        let inserts = 0;
        export const wrapOpenAI = x => x;
        export const initDataset = () => ({
          insert() { inserts++; },
          async flush() {},
          async summarize() { return { datasetName: "Old 310-row dataset", dataSummary: { totalRecords: 310 } }; },
          [Symbol.asyncIterator]() { throw new Error("Must not evaluate the persistent dataset"); }
        });
        export async function Eval(name, options) {
          assert.equal(inserts, 20);
          assert.ok(Array.isArray(options.data));
          assert.equal(options.data.length, 20);
          assert.equal(new Set(options.data.map(row => row.id)).size, 20);
          console.log("VERIFIED_SELECTED_CASES");
          return { summary: {} };
        }
      \`;
      registerHooks({ resolve(specifier, context, next) {
        const source = specifier === "braintrust" ? braintrust :
          specifier === "openai" ? "export default class OpenAI {}" : null;
        return source === null ? next(specifier, context) : {
          url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true
        };
      }});
      globalThis.fetch = async () => ({ ok: true });
    `);
    const output = execFileSync(process.execPath, ["--import", hook, "scripts/run-pilot-evals.mjs"], {
      cwd: new URL("../", import.meta.url),
      env: { PATH: process.env.PATH, BRAINTRUST_API_KEY: "test-only", BRAINTRUST_PROJECT_ID: "test-only" },
      encoding: "utf8",
    });
    assert.equal(output.split("VERIFIED_SELECTED_CASES").length - 1, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
