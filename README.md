# Spark

Spark is a fictional electric-vehicle ownership portal built for story-driven Braintrust demos. The customer can charge their vehicle, spend Spark Credits in a small accessories shop, create persistent orders, and ask support about the same live account state.

See [docs/demo-story.md](docs/demo-story.md) for the narrative and proof points. Use [docs/se-demo-runbook.md](docs/se-demo-runbook.md) for the live click path, persona handoffs, optional branches, and reset steps.

The primary demo follows one mixed-intent request:

> My home charger keeps cutting out. I already bought a replacement, so I want to return this one.

The baseline concierge prioritizes the charger malfunction and drops the requested return. The improved concierge preserves the customer's action intent, routes to Orders and Returns, checks the order, asks for confirmation, and creates a pending return request.

Use the internal scenario bar to load `Faulty Home Connector`, start a charging session, and follow the failure into support. `Duplicate order` creates two matching processing orders so the agent can safely cancel one and restore its Spark Credits after confirmation. `Everyday account` is the default and charges normally. The other scenarios create a delayed replacement or a missing refund without changing application code.

## Run locally

Requirements: Node.js 22.13 or newer and access to a Braintrust project.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill in `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT_ID` in `.env.local` before using chat. Both values stay in the server environment. Spark does not accept credentials from the browser or store them in D1. Environment files are ignored by Git, while `.env.example` is intentionally safe to commit.

Without both values, the ownership portal still loads but chat returns a configuration-required response instead of calling a model.

Open the default URL for `baseline-v1`. Add `?agent=improved` for `improved-v1`.

## Trace shape

Each complete multi-turn conversation is one `spark.support_conversation` root trace. Every turn, concierge decision, specialist run, model call, and tool execution is a child span. Root metadata includes the scenario ID, source, fixed model snapshot, prompt version, and applicable behavior specs.

## Scenario workflow

The project-local `generate-spark-scenarios` skill maintains realistic, non-duplicative customer scripts in `scenarios/manifest.json`.

```bash
npm run scenarios:check
npm run scenarios:pilot
npm run scenarios:daily
npm run evals:pilot
```

The pilot runner refuses to recycle a smaller scenario set to reach a larger count. Expand and validate the manifest before running the 300-conversation seed.

`npm run evals:pilot` upserts the 20 scenarios into the `Spark Support Pilot v1` Braintrust dataset, then runs the same conversations through `baseline-v1` and `improved-v1`. It uses one deterministic scorer for required tool coverage and four GPT-4o judges for goal resolution, groundedness, safe action handling, and overall support quality. Judge calls are traced inside the experiment with their prompts, outputs, token usage, and cost. Eval caching is disabled so each pilot contains genuinely fresh conversations and scores. Each invocation creates a clean pair with a shared timestamp label. Pass `--run-label=your-label` when you want a memorable pair of experiment names. Use `--only=improved` for a single 20-conversation run, and optionally provide `--base-experiment=experiment-name` for a comparison. Runs default to one conversation at a time for local reliability; increase this deliberately with `--concurrency=2` or higher.

## Braintrust playgrounds

Spark includes four remote eval tasks for Braintrust playgrounds: the full agent, routing, response composition, and scorer calibration. Seed the two fixed ten-case datasets with `npm run playgrounds:seed`, start Spark with `npm run dev`, and start the remote eval source with `npm run playgrounds:dev`. Configure `http://localhost:8300` as a remote eval source in the Spark-Demo project. Each playground can then use its matching task and ten-case dataset without creating an experiment.

The full-agent task exposes the model, router system prompt, all three specialist system prompts, router and specialist temperatures, and the maximum tool-step count. The focused routing, response, and scorer-calibration tasks expose the model and prompt controls relevant to their layer. Playground overrides are accepted only when the request source is `playground`; the normal Spark website continues using its configured defaults.

Run `npm run playgrounds:smoke` to execute all four tasks locally against exactly ten cases without sending experiment results to Braintrust. The full-agent task still sends its ordinary application traces to Spark-Demo.

If the Braintrust CLI cannot infer the correct organization when starting the remote eval server, append it explicitly:

```bash
npm run playgrounds:dev -- --dev-org-name "Your Braintrust organization"
```

## Publishing and hosting

Spark is designed for bring-your-own credentials. The safest public setup is for each user to clone or deploy their own copy and configure `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT_ID` as server-side environment variables. Do not add a browser API-key field and do not configure a shared public deployment with an internal key.

The current application uses a Cloudflare Worker and D1. Cloudflare is therefore the direct deployment target. A Vercel deployment would require replacing or adapting the Worker and D1 bindings. A shared hosted showcase can leave chat unconfigured, while a self-hosted deployment enables chat with the deployer's own credentials.

## Automated trace generation

The `Generate daily Spark traces` GitHub Actions workflow starts Spark inside a private runner and generates five complete `story-v2` conversations each day. It can also be started manually from the repository's Actions tab. Runs are sequential, capped at 30 minutes, and never overlap.

Configure these under **Settings > Secrets and variables > Actions** before the first run:

- Secret: `BRAINTRUST_API_KEY`
- Variable: `BRAINTRUST_PROJECT_ID`

The API key is available only to the workflow process. It is not committed, sent to the browser, or made available to pull requests from forks.

## Data and safety

Spark uses a fictional, unnamed customer and isolates credits, orders, charging sessions, and scenario state by an anonymous demo account in Cloudflare D1. The browser stores only the anonymous account cookie, not authoritative product state. The application does not import or depend on the local Braintrust evidence workspace; that workspace is used only as read-only evidence while developing current Braintrust integrations.
