# Spark demo story

## What we are showing

Spark starts with a support agent that sounds helpful but has a few believable production problems. It can answer from stale prompt context instead of live account tools, lose the customer's requested outcome when two issues appear together, ask for unnecessary details after an action is confirmed, or forget that a check already happened earlier in the conversation.

The improved agent follows one clear behavior contract:

- Current account facts come from tools.
- The customer's requested outcome survives routing.
- Consequential actions require confirmation, then complete without another unnecessary question.
- Completed checks persist across turns, so the agent moves to the next useful step instead of repeating work.

This is not a tour of every Spark feature. The app creates the customer interaction, Braintrust shows where the behavior broke, and the experiment proves that the change fixed it without hurting the rest of the workflow.

## The cleanest demo path

1. Start with a customer problem in Spark. Good options are an active-warranty question, a cold-weather range concern, or a confirmed connector return.
2. Open the matching baseline trace. Show the moment the answer sounds reasonable but has no supporting tool call, or the confirmed action stops short of completion.
3. Move to the playground. The AI engineer and SME tighten the behavior contract around tool grounding, confirmation, and completed work.
4. Run the same scenario against the improved agent. Open the trace and show the route, model decision, tool execution, and final response in order.
5. Finish in the experiment comparison. The point is not that one answer got better. The same change improved the weak cases and held across the Core 10.

For a shorter demo, use one baseline trace, one improved trace, and the experiment summary. For a fuller demo, add the PM finding the pattern, the SME defining the expected behavior, and the AI engineer validating the change.

## Best proof points

### Live facts instead of plausible answers

In the warranty and cold-weather scenarios, the baseline can sound correct while relying on static context. The improved agent calls `get_vehicle_status` and grounds the answer in the current account.

### Confirmed action actually completes

In the connector-return scenario, the baseline checks the order and eligibility but asks for another optional detail after the customer confirms. The improved agent creates the pending return request and reports the real resulting state.

### The conversation remembers completed work

In the intermittent-charging scenario, a prompt-only fix still allowed the agent to offer diagnostics after diagnostics had already run. Spark now persists completed tool operations by conversation. The next turn receives that structured history and moves to the next safe step or escalation.

## Example experiments

- Baseline: `spark-agent-v1-bd9a17ec`
- Improved: `spark-agent-v2-story-v4`

These names record the comparison used while developing Spark. Run the evals in your own Braintrust project to create a fresh pair that you can open and share.

The final Core 10 comparison completed with zero errors. The result is intentionally not perfect. The improved agent fixes the main tool-coverage failure while leaving a few smaller quality gaps that an SE can inspect or use as the start of the next iteration.

| Scorer | Baseline | Improved |
| --- | ---: | ---: |
| Goal resolution | 95% | 95% |
| Groundedness | 97.5% | 95% |
| Required tool coverage | 96.67% | 100% |
| Safe action handling | 100% | 100% |
| Support quality | 100% | 97.5% |
| Average tokens | 4,678.1 | 4,930.8 |
| Average estimated cost | $0.01499 | $0.01476 |

The strongest single example is the mixed charging and return request. Required tool coverage improves from 66.7% to 100%, and the other four scores reach 100% for that case. Across the full set, cost stays effectively flat and the aggregate scores show honest tradeoffs instead of a manufactured sweep.

## How to use the existing trace corpus

Spark already has roughly 660 project traces. That is enough data for Patterns, Topics, Monitor, and log exploration. Treat it as a historical production-like corpus, not as a claim that every trace came from the latest agent version.

Use prompt version, source, scenario ID, and timestamp metadata to separate older behavior from current behavior. Use the two reference experiments above when making a controlled baseline-versus-improved claim, because both sides ran on the same fixed Core 10 dataset and were fully scored. Only add a small fresh trace set when a new workflow needs to appear in Logs or a product feature needs recent data.

## Persona handoff

- PM: finds the repeated customer behavior or failure pattern and curates representative examples.
- SME: defines what a safe, grounded, complete response should do.
- AI engineer: inspects traces, changes the prompt or workflow, and runs the comparison experiment.
- Agent: routes the request, calls live tools, preserves conversation state, and completes the approved action.

The narrative can start with any persona. The important part is that they are working on the same customer problem, not presenting separate product features.
