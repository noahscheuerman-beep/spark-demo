const defaults = {
  BRAINTRUST_API_URL: "https://api.braintrust.dev",
  BRAINTRUST_APP_URL: "https://www.braintrust.dev",
  OPENAI_BASE_URL: "https://api.braintrust.dev/v1/proxy",
  SPARK_MODEL: "gpt-4o-2024-11-20",
  SPARK_PROMPT_VERSION: "baseline-v1",
} as const;

function readRuntimeValue(name: string) {
  return process.env[name]?.trim();
}

export function getSparkConfig() {
  return {
    braintrustApiKey: readRuntimeValue("BRAINTRUST_API_KEY") ?? "",
    braintrustProjectId: readRuntimeValue("BRAINTRUST_PROJECT_ID") ?? "",
    internalToken: readRuntimeValue("SPARK_INTERNAL_TOKEN") ?? "",
    braintrustApiUrl: readRuntimeValue("BRAINTRUST_API_URL") ?? defaults.BRAINTRUST_API_URL,
    braintrustAppUrl: readRuntimeValue("BRAINTRUST_APP_URL") ?? defaults.BRAINTRUST_APP_URL,
    openaiBaseUrl: readRuntimeValue("OPENAI_BASE_URL") ?? defaults.OPENAI_BASE_URL,
    model: readRuntimeValue("SPARK_MODEL") ?? defaults.SPARK_MODEL,
    promptVersion: readRuntimeValue("SPARK_PROMPT_VERSION") ?? defaults.SPARK_PROMPT_VERSION,
  };
}
