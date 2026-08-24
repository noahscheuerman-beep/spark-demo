import { initDataset } from "braintrust";
import { calibrationCases, coreEvalCases } from "./fixtures";

const PROJECT_ID = process.env.BRAINTRUST_PROJECT_ID;
const APP_URL = process.env.BRAINTRUST_APP_URL || "https://www.braintrust.dev";

if (!process.env.BRAINTRUST_API_KEY) {
  throw new Error("BRAINTRUST_API_KEY is required. Load .env.braintrust before seeding playground datasets.");
}
if (!PROJECT_ID) {
  throw new Error("BRAINTRUST_PROJECT_ID is required. Load .env.braintrust before seeding playground datasets.");
}

async function seed(name: string, description: string, records: typeof coreEvalCases | typeof calibrationCases) {
  const dataset = initDataset({
    projectId: PROJECT_ID,
    dataset: name,
    description,
    appUrl: APP_URL,
    metadata: { app: "spark", purpose: "playground", fixed_size: 10 },
  });
  for (const record of records) dataset.insert(record);
  await dataset.flush();
  const summary = await dataset.summarize();
  console.log(`${summary.datasetName}: ${summary.dataSummary?.totalRecords ?? records.length} records`);
  console.log(summary.datasetUrl);
}

await seed(
  "Spark Playground Core 10 v1",
  "Ten fixed, hand-authored Spark conversations spanning charging, vehicle, orders, returns, and escalation.",
  coreEvalCases,
);
await seed(
  "Spark Scorer Calibration 10 v1",
  "Ten human-authored pass, fail, and borderline responses for calibrating Spark GPT-4o judges.",
  calibrationCases,
);
