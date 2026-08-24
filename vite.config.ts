import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

function createLocalBindingConfig(runtimeEnv: Record<string, string | undefined>) {
  return {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      BRAINTRUST_API_KEY: runtimeEnv.BRAINTRUST_API_KEY ?? "",
      BRAINTRUST_PROJECT_ID: runtimeEnv.BRAINTRUST_PROJECT_ID ?? "",
      BRAINTRUST_API_URL: runtimeEnv.BRAINTRUST_API_URL ?? "https://api.braintrust.dev",
      BRAINTRUST_APP_URL: runtimeEnv.BRAINTRUST_APP_URL ?? "https://www.braintrust.dev",
      OPENAI_BASE_URL: runtimeEnv.OPENAI_BASE_URL ?? "https://api.braintrust.dev/v1/proxy",
      SPARK_MODEL: runtimeEnv.SPARK_MODEL ?? "gpt-4o-2024-11-20",
      SPARK_PROMPT_VERSION: runtimeEnv.SPARK_PROMPT_VERSION ?? "baseline-v1",
    },
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };
}

export default defineConfig(async ({ mode }) => {
  const runtimeEnv = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: createLocalBindingConfig(runtimeEnv),
      }),
    ],
  };
});
