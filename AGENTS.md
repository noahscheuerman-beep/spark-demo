# Spark demo project

Spark is a story-driven Braintrust demo. Keep the customer experience believable first, then expose the agent behavior through Braintrust traces and evals.

## Braintrust evidence

- Treat the configured Braintrust evidence workspace as read-only evidence.
- Read its root `AGENTS.md` before inspecting repositories there.
- Use enabled repositories from `readonly-repos.tsv`, choosing the smallest relevant source set.
- Never import code from Repo-Resources at runtime or copy private customer data into Spark.
- Prefer public contracts, current SDK behavior, and tests. Record the inspected repository commit when evidence changes an implementation decision.

## Product constraints

- One complete multi-turn conversation is one root Braintrust trace.
- Keep tool calls, routing decisions, model calls, and specialist work as child spans.
- Use the fixed GPT-4o snapshot configured by `SPARK_MODEL`.
- Keep the initial support surface limited to vehicle questions, charging, orders, returns, refunds, and human escalation.
- Never create a return or another consequential action without explicit user confirmation.
- Keep scenarios realistic, varied, de-identified, and cheap to run.
