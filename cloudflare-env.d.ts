declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BRAINTRUST_API_KEY?: string;
      BRAINTRUST_PROJECT_ID?: string;
      BRAINTRUST_API_URL?: string;
      BRAINTRUST_APP_URL?: string;
      OPENAI_BASE_URL?: string;
      SPARK_MODEL?: string;
      SPARK_PROMPT_VERSION?: string;
    }
  }

  interface Env {
    DB: D1Database;
    BRAINTRUST_API_KEY?: string;
    BRAINTRUST_PROJECT_ID?: string;
    BRAINTRUST_API_URL?: string;
    BRAINTRUST_APP_URL?: string;
    OPENAI_BASE_URL?: string;
    SPARK_MODEL?: string;
    SPARK_PROMPT_VERSION?: string;
  }
}

export {};
