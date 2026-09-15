export function assertEvalCaseCount(cases) {
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 25) {
    throw new Error("Each Spark demo experiment must contain 1–25 cases.");
  }
}

export function selectEvalScenarios(manifest, suite) {
  if (!["pilot", "loom"].includes(suite)) throw new Error("Unknown eval suite");
  const cases = suite === "loom"
    ? manifest.filter((scenario) => scenario.id.startsWith("seed-faulty-connector-return-"))
    : manifest.slice(0, 20);
  const expected = suite === "loom" ? 10 : 20;
  if (cases.length !== expected) throw new Error(`${suite} requires exactly ${expected} scenarios; found ${cases.length}.`);
  assertEvalCaseCount(cases);
  return cases;
}
