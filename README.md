# Spark

Spark is a fictional electric-vehicle ownership portal built for story-driven Braintrust demos. The customer can charge their vehicle, spend Spark Credits in a small accessories shop, create persistent orders, and ask support about the same live account state.

The primary demo follows one mixed-intent request:

> My home charger keeps cutting out. I already bought a replacement, so I want to return this one.

The baseline concierge prioritizes the charger malfunction and drops the requested return. The improved concierge preserves the customer's action intent, routes to Orders and Returns, checks the order, asks for confirmation, and creates a pending return request.

Use the internal scenario bar to load `Faulty Home Connector`, start a charging session, and follow the failure into support. `Duplicate order` creates two matching processing orders so the agent can safely cancel one and restore its Spark Credits after confirmation. `Everyday account` is the default and charges normally. The other scenarios create a delayed replacement or a missing refund without changing application code.

## Run locally

Requirements: Node.js 22 and access to a Braintrust project.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill in `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT_ID` in `.env.local` before using chat. Spark uses the server-side Braintrust key for Gateway model calls and sends every trace to the configured project. The key is never sent to the browser.

Local development uses `spark-demo.db` automatically. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when you want to test against the hosted database. Environment files and the local database are ignored by Git, while `.env.example` is intentionally safe to commit.

Local development is open when `SPARK_ACCESS_CODE` is empty. Set it when you want to exercise the team-access screen locally. Hosted Vercel deployments fail closed until `SPARK_ACCESS_CODE` is configured. Successful access creates a secure, HTTP-only cookie that lasts for 12 hours.

Without the server key and project ID, the ownership portal still loads locally but chat returns a configuration-required response instead of calling a model.

Open the default URL for `baseline-v1`. Add `?agent=improved` for `improved-v1`.

## Trace shape

Each complete multi-turn conversation is one `spark.support_conversation` root trace. Every turn, concierge decision, specialist run, model call, and tool execution is a child span. Root metadata includes the scenario ID, source, fixed model snapshot, prompt version, and applicable behavior specs.

## Demo setup: seed Logs first, then run small experiments

**Target: approximately 310 complete conversations in Logs, then 1–2 experiments with 20 cases each. The experiment limit is 25 cases.** One conversation is one root trace; its turns and tool calls are child spans, not additional cases.

Keep `npm run dev` running with the Braintrust credentials configured above. Run the following from the project directory in a second terminal.

### 1. Validate the scenario files (local only)

```bash
npm run scenarios:check
```

This checks all 310 scenario definitions. It creates **no logs, datasets, or experiments**. “Validated 310 scenarios” does not mean anything has been uploaded.

### 2. Seed approximately 310 conversations into the Logs page

```bash
npm run logs:seed
```

This runs all 310 conversations through Spark and writes application traces to **your configured Braintrust project → Logs**. It creates **zero experiments**. This is the bulk demo seeding step and makes real model calls. Wait for completion, check the reported successes/failures, and verify the root conversations in Logs before continuing.

Run this once for a fresh demo project. Re-running adds another batch of traces; it does not replace existing logs. If the project already has the seed logs, skip this step. A failed or partial run should be inspected before retrying the whole batch.

Preview the selection without model calls or uploads:

```bash
npm run logs:seed -- --dry-run=true
```

### 3. Create one or two small experiments

For the initial baseline/improved comparison, run:

```bash
node --env-file=.env.local scripts/run-pilot-evals.mjs
```

This creates **two experiments with exactly 20 cases each** in **your project → Experiments**. Alternatively, start with just one:

```bash
node --env-file=.env.local scripts/run-pilot-evals.mjs --only=improved
```

Choose one of these commands; do not run both during initial setup. If credentials are already exported in your terminal, the equivalent commands are `npm run evals:pilot` and `npm run evals:pilot -- --only=improved`. If you keep the credentials in `.env.braintrust`, use that filename instead of `.env.local`.

The runner upserts the selected 20 cases into `Spark Support Pilot v1`, but evaluates **only those 20 selected cases**, even if that saved dataset contains older or additional rows. It refuses to start an experiment with more than 25 cases. Experiment conversations attach to the experiment traces; this command is not the bulk Logs seeder. No existing datasets or experiments are deleted.

Preview the experiment count without credentials, model calls, or uploads:

```bash
npm run evals:pilot -- --dry-run=true
```

Each real invocation creates new experiments. A comparison uses a shared timestamp label; optionally pass `--run-label=your-label`. For a single improved run, `--base-experiment=experiment-name` selects an existing comparison. Runs default to one conversation at a time. The pilot uses required-tool coverage plus four GPT-4o judges, with fresh conversations and scores on every run.

### Other commands (optional, not initial setup steps)

| Command | Destination | Amount |
| --- | --- | --- |
| `npm run scenarios:check` | Local validation only | No uploads |
| `npm run logs:seed` | Logs | 310 conversations, zero experiments |
| `npm run scenarios:pilot` | Logs | 20 conversations, zero experiments |
| `npm run scenarios:daily` | Logs | 5 conversations, zero experiments |
| `npm run evals:pilot` | Experiments | 2 experiments × 20 cases |
| `npm run evals:pilot -- --only=improved` | Experiments | 1 experiment × 20 cases |

Experiment commands need credentials in the terminal environment, as shown above. The project-local `generate-spark-scenarios` skill maintains `scenarios/manifest.json`. The Logs runner refuses to recycle a smaller scenario set to meet a larger count.

## Braintrust playgrounds

Spark includes four remote eval tasks for Braintrust playgrounds: the full agent, routing, response composition, and scorer calibration. Seed the two fixed ten-case datasets with `npm run playgrounds:seed`, start Spark with `npm run dev`, and start the remote eval source with `npm run playgrounds:dev`. Configure `http://localhost:8300` as a remote eval source in the Spark-Demo project. Each playground can then use its matching task and ten-case dataset without creating an experiment.

The full-agent task exposes the model, router system prompt, all three specialist system prompts, router and specialist temperatures, and the maximum tool-step count. The focused routing, response, and scorer-calibration tasks expose the model and prompt controls relevant to their layer. Playground overrides are accepted only when the request source is `playground`; the normal Spark website continues using its configured defaults. On a deployed instance, set `SPARK_INTERNAL_TOKEN` on both the Spark server and the remote eval runner. This prevents a public caller from selecting internal sources or supplying playground overrides.

Run `npm run playgrounds:smoke` to execute all four tasks locally against exactly ten cases without sending experiment results to Braintrust. The full-agent task still sends its ordinary application traces to Spark-Demo.

If the Braintrust CLI cannot infer the correct organization when starting the remote eval server, append it explicitly:

```bash
npm run playgrounds:dev -- --dev-org-name "Your Braintrust organization"
```

## Publishing and hosting

Spark is a native Next.js application and can be imported into Vercel without a custom build command or `vercel.json` file. Before the first deployment:

1. Import this repository into the intended Vercel project.
2. Add a Turso database through the Vercel Marketplace, or provide `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` manually. Spark creates its demo tables on first use.
3. Add `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT_ID` for server-side Gateway calls and tracing. Point `BRAINTRUST_PROJECT_ID` at the shared Spark-Demo project.
4. Add a memorable internal `SPARK_ACCESS_CODE` and share it only with the Braintrust SE team. The hosted app is unavailable until this is configured.
5. Add a separate long, random `SPARK_INTERNAL_TOKEN` if the deployed app will serve remote evals or playgrounds.
6. Deploy, sign in with the team access code, and run one account action plus one chat turn as a smoke test.

Interactive model calls use the deployment's server-side Braintrust key. A shared team-access gate protects the website and APIs, while `SPARK_INTERNAL_TOKEN` separately authenticates deployed playground and automated-eval requests. Do not reuse either access value as a Braintrust credential.

The Vercel CLI is optional. The dashboard can perform the initial import and Marketplace connection; after the project exists, `vercel link` and `vercel deploy` are useful for repeat deployments and smoke testing.

## Automated trace generation

The `Generate daily Spark traces` GitHub Actions workflow starts Spark inside a private runner and generates five complete `story-v2` conversations each day. It can also be started manually from the repository's Actions tab. Runs are sequential, capped at 30 minutes, and never overlap.

Configure these under **Settings > Secrets and variables > Actions** before the first run:

- Secret: `BRAINTRUST_API_KEY`
- Variable: `BRAINTRUST_PROJECT_ID`

The API key is available only to the workflow process. It is not committed, sent to the browser, or made available to pull requests from forks.

## Data and safety

Spark uses a fictional, unnamed customer and isolates credits, orders, charging sessions, and scenario state by an anonymous demo account in Turso. The browser stores only the anonymous account cookie and the HTTP-only internal-access cookie, not authoritative product state or Braintrust credentials. The application does not import or depend on the local Braintrust evidence workspace; that workspace is used only as read-only evidence while developing current Braintrust integrations.
