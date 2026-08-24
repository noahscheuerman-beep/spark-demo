---
name: generate-spark-scenarios
description: Create and maintain realistic, varied synthetic customer conversations for the Spark electric-vehicle support demo. Use when adding pilot, seed, daily, regression, or failure-mode scenarios; expanding coverage across charging, vehicle, order, return, refund, FAQ, and escalation workflows; or checking that new Spark scenarios are meaningfully different from the existing manifest.
---

# Generate Spark Scenarios

Produce scenario fixtures that a deterministic runner can play against the real Spark agent. Do not use an LLM as the faux customer during a trace run.

## Create a batch

1. Read [the scenario contract](references/scenario-contract.md) completely.
2. Read `../../../scenarios/manifest.json` before drafting anything.
3. Count current coverage by domain, goal, expected route, failure mode, tools, and behavior specs. Fill gaps instead of repeating the largest category.
4. Start each scenario from a plausible customer situation. Never start from a Braintrust feature, desired trace shape, or evaluator.
5. Write complete multi-turn customer scripts. Make later turns coherent even if the agent asks a slightly different follow-up question.
6. Assign a unique ID and variation key. Vary at least three of these facets when reusing a broad intent: wording, customer state, product state, order state, urgency, requested outcome, route, tool path, or resolution.
7. Run `node scripts/check-novelty.mjs ../../../scenarios/manifest.json` from this skill directory.
8. Revise every duplicate or high-similarity failure before returning the batch.

## Preserve realism

- Use ordinary customer language. Avoid “agent,” “eval,” “trace,” “scorer,” “routing,” “tool call,” and Braintrust product language in customer turns.
- Keep customer turns concise and uneven. Real people provide incomplete information, correct themselves, and sometimes combine two needs.
- Include routine successes and believable failures. Do not make every scenario adversarial.
- Use only the fictional Spark customer, vehicle, orders, and support policies defined in the contract.
- Never include real customers, prospect details, call excerpts, personal information, or credentials.
- Do not claim that a refund is immediate. Spark creates pending return requests after explicit confirmation.

## Protect trace quality and cost

- Treat one complete conversation as one root trace.
- Default to three customer turns. Use two or four only when the story requires it.
- Keep each customer turn below 80 words.
- Declare expected routing, tools, outcome, and behavior specs as hidden ground truth.
- Do not emit traces or call models unless the user explicitly asks to run the scenarios.
- Never recycle scenarios to reach a requested count. If the manifest has fewer unique scenarios than requested, stop and expand it first.
