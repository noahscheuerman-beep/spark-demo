# Spark SE demo runbook

## The story in one sentence

A customer reports a faulty home charger and asks to return the replacement they already bought. The support agent sounds helpful, but the baseline loses the customer's actual goal. Braintrust reveals the failure, helps the team define the expected behavior, and shows that the improved workflow completes the return safely without materially increasing cost.

## What to have open

- The Spark website on the `Faulty Home Connector` scenario
- The baseline experiment: `spark-agent-v1-bd9a17ec`
- The improved experiment: `spark-agent-v2-story-v4`
- A playground using the Spark Full Agent task and Core 10 dataset
- Spark project Logs, filtered to the faulty-charger scenario when possible

Do not depend on a particular log ID, since live interactions create new traces.

## Primary path

### 1. Begin with the customer

In Spark, load `Faulty Home Connector` and start from the customer's situation:

> My home charger keeps cutting out. I already bought a replacement, so I want to return this one.

Let the app establish that this is a real workflow with account state, orders, eligibility, and a consequential action. Do not begin with a Braintrust product tour.

### 2. Show the believable failure

Open the matching baseline example. The answer may sound reasonable, but the baseline prioritizes the charging symptom and does not fully preserve the requested return outcome.

In the trace, focus on three questions:

- What did the router think the customer wanted?
- Which account tools did the agent call?
- Did the workflow reach the action the customer actually requested?

The issue is not bad wording. It is a workflow failure that a plausible final answer can hide.

### 3. Hand the problem across personas

- The PM identifies the repeated behavior and curates the example.
- The support SME defines the expected behavior: preserve both intents, use live account tools, require explicit confirmation, and complete the return after confirmation.
- The AI engineer inspects the trace and changes the prompt, routing contract, or guardrail.

Keep everyone on the same customer problem. The personas are handoffs in one story, not separate feature demos.

### 4. Test the proposed fix

In the playground, run the same example against the baseline and improved configurations. Expose the system prompt, model, specialist prompts, temperatures, and maximum tool steps only as they become relevant to the investigation.

The useful question is: did the change fix the requested outcome without breaking grounding, confirmation, or cost?

### 5. Prove it in the trace

Open the improved trace and follow the sequence:

1. The router preserves both charging and return intent.
2. The agent reads the relevant order and return eligibility from tools.
3. The agent asks for explicit confirmation before the consequential action.
4. After confirmation, the return tool runs once.
5. The final answer reports the resulting account state.

One complete multi-turn conversation should appear as one root trace, with routing, model calls, specialist work, and tools as child spans.

### 6. Finish with the experiment

Compare the final Core 10 experiments. For the primary mixed-intent case, required tool coverage improves from 66.7% to 100% and all five scores reach 100%. Across the full dataset, tool coverage improves from 96.67% to 100%, goal resolution stays at 95%, safety stays at 100%, and estimated cost remains effectively flat.

Call out the honest tradeoffs. Aggregate groundedness moves from 97.5% to 95%, support quality moves from 100% to 97.5%, and average tokens increase. That gives the team a real next question instead of pretending the system is finished.

## Optional branches

Use these when they match the prospect's pain. Do not force all of them into one demo.

- Warranty question: show why an active warranty answer should use current vehicle state instead of stale prompt context.
- Cold-weather range: show a response that can be useful yet still receive a partial grounding score.
- Intermittent charging: show how persisted tool history prevents repeated diagnostics across turns.
- Duplicate order: load the `Duplicate order` scenario, let Patterns identify the missing action path, then show the improved agent find the two processing orders, request confirmation, cancel only `ORD-2212`, and restore the Spark Credits. Reset to `Everyday account` to show the unseen variant escalating urgently without returning `ORD-1842`.
- Escalation: show the difference between recommending escalation and performing it without confirmation.
- Patterns or Topics: start from the existing trace corpus and move from a repeated behavior to a curated eval case.

## How to use the 660 existing traces

The existing traces are the production-like backdrop. They are useful for discovering clusters, filtering Logs, and showing online scoring over time. Some predate the latest workflow changes, so do not use the entire corpus as a controlled before-and-after comparison.

For version-specific claims, filter by prompt version and timestamp or use the reference experiments. If a new release needs fresh data, run a small targeted batch that exercises that feature. Do not regenerate hundreds of conversations just to make the project look active.

## What not to do

- Do not lead with a long flywheel explanation.
- Do not click through every Braintrust page.
- Do not claim that the improved agent is perfect.
- Do not tune scorers to make the improved version win.
- Do not use the large historical corpus as if it were one controlled eval.
- Do not run a consequential tool before explicit customer confirmation.

## Reset between demos

Reload the `Faulty Home Connector` scenario to restore the intended account state. Start a new support conversation so its trace has a clean root. Confirm that the app and the remote playground source are running before the call. If the prospect wants to explore, use a new conversation rather than changing the canonical experiment.
