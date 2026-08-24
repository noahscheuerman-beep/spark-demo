import { initLogger, startSpan, traced, withParent, wrapOpenAI } from "braintrust";
import type { PropagationContext } from "braintrust";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { runTool } from "./domain";
import { getSparkConfig } from "./config";
import { hasExplicitActionConfirmation } from "./confirmation";
import { routerPrompt, specialistPrompt } from "./prompts";
import { errorDetails, logSparkEvent, withAbortTimeout } from "./runtime";
import type { AgentContext, ChatMessage, RouteDecision, Specialist, SupportResult } from "./types";

const ROUTER_MODEL_TIMEOUT_MS = 20_000;
const SPECIALIST_MODEL_TIMEOUT_MS = 25_000;
const TOOL_TIMEOUT_MS = 8_000;
const TRACE_EXPORT_TIMEOUT_MS = 5_000;
const TRACE_FLUSH_TIMEOUT_MS = 5_000;
const TURN_TIMEOUT_MS = 60_000;

const routerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    specialist: { type: "string", enum: ["vehicle_charging", "orders_returns", "general_support"] },
    primaryIntent: { type: "string" },
    requestedAction: { anyOf: [{ type: "string" }, { type: "null" }] },
    secondaryIntent: { anyOf: [{ type: "string" }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["specialist", "primaryIntent", "requestedAction", "secondaryIntent", "confidence"],
} as const;

const toolsBySpecialist: Record<Specialist, ChatCompletionTool[]> = {
  vehicle_charging: [
    { type: "function", function: { name: "get_vehicle_status", description: "Get the customer's current Spark vehicle status.", strict: true, parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } } },
    { type: "function", function: { name: "diagnose_home_charger", description: "Get safe diagnostics and first steps for the customer's connected home charger.", strict: true, parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } } },
    { type: "function", function: { name: "escalate_to_human", description: "Queue a case for a human support specialist after the customer agrees.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { reason: { type: "string" } }, required: ["reason"] } } },
  ],
  orders_returns: [
    { type: "function", function: { name: "get_recent_orders", description: "List the customer's recent Spark orders.", strict: true, parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } } },
    { type: "function", function: { name: "get_pending_orders", description: "List visible pre-shipment orders that can still be canceled.", strict: true, parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } } },
    { type: "function", function: { name: "check_return_eligibility", description: "Check whether an order can be returned.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { orderId: { type: "string" } }, required: ["orderId"] } } },
    { type: "function", function: { name: "create_return_request", description: "Create a pending return request only after explicit customer confirmation.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { orderId: { type: "string" }, reason: { type: "string" }, confirmed: { type: "boolean" } }, required: ["orderId", "reason", "confirmed"] } } },
    { type: "function", function: { name: "cancel_pending_order", description: "Cancel a visible processing order and restore its Spark Credits only after explicit customer confirmation.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { orderId: { type: "string" }, confirmed: { type: "boolean" } }, required: ["orderId", "confirmed"] } } },
    { type: "function", function: { name: "escalate_to_human", description: "Queue a case for a human support specialist after the customer agrees.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { reason: { type: "string" } }, required: ["reason"] } } },
  ],
  general_support: [
    { type: "function", function: { name: "get_vehicle_status", description: "Get the customer's current Spark vehicle status.", strict: true, parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } } },
    { type: "function", function: { name: "get_recent_orders", description: "List the customer's recent Spark orders.", strict: true, parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } } },
    { type: "function", function: { name: "escalate_to_human", description: "Queue a case for a human support specialist after the customer agrees.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { reason: { type: "string" } }, required: ["reason"] } } },
  ],
};

function createClient() {
  const config = getSparkConfig();
  const hardTimeoutFetch: typeof fetch = (input, init) => {
    // The OpenAI SDK clears its own timeout after response headers arrive. A
    // separate signal must remain live while the response body is being read,
    // otherwise a stalled body can keep the Worker request open indefinitely.
    const timeoutSignal = AbortSignal.timeout(SPECIALIST_MODEL_TIMEOUT_MS);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return globalThis.fetch(input, { ...init, signal });
  };
  const raw = new OpenAI({
    apiKey: config.braintrustApiKey,
    baseURL: config.openaiBaseUrl,
    maxRetries: 0,
    timeout: SPECIALIST_MODEL_TIMEOUT_MS,
    fetch: hardTimeoutFetch,
  });
  return wrapOpenAI(raw);
}

function toModelMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.slice(-10).map((message) => ({ role: message.role, content: message.content }));
}

function fallbackRoute(message: string): RouteDecision {
  const lower = message.toLowerCase();
  const requestedAction = /cancel/.test(lower)
    ? "cancel an order"
    : /return|refund|replace/.test(lower)
      ? "return or replace an order"
      : null;
  if (/charger|charging|range|battery|vehicle|car|performance/.test(lower)) {
    return { specialist: "vehicle_charging", primaryIntent: "charging or vehicle support", requestedAction, secondaryIntent: requestedAction ? "order return" : null, confidence: 0.78 };
  }
  if (/order|return|refund|replace|cancel|delivery/.test(lower)) {
    return { specialist: "orders_returns", primaryIntent: "order or return support", requestedAction, secondaryIntent: null, confidence: 0.84 };
  }
  return { specialist: "general_support", primaryIntent: "general support", requestedAction, secondaryIntent: null, confidence: 0.62 };
}

function fallbackResponse(route: RouteDecision) {
  if (route.specialist === "vehicle_charging") return "I can help check the charger. Is the status light on your Spark Home Connector blinking, solid, or completely off when the charging session stops?";
  if (route.specialist === "orders_returns") return "I can check your current orders, including whether a pre-shipment order can still be canceled. Which order or item should I look for?";
  return "I can help with your Spark vehicle, charging setup, recent orders, or connect you with a support specialist. What would you like to sort out?";
}

async function decideRoute(
  client: OpenAI,
  messages: ChatMessage[],
  context: AgentContext,
) {
  return traced(async (span) => {
    const startedAt = Date.now();
    const promptVersion = context.promptVersion ?? getSparkConfig().promptVersion;
    const model = context.playgroundOverrides?.model ?? getSparkConfig().model;
    logSparkEvent("info", "routing.model.started", {
      request_id: context.requestId,
      session_id: context.sessionId,
      scenario_id: context.scenarioId,
      model,
      prompt_version: promptVersion,
    });
    let response;
    try {
      response = await withAbortTimeout(
        {
          operation: "routing model request",
          timeoutMs: ROUTER_MODEL_TIMEOUT_MS,
          parentSignal: context.requestSignal,
        },
        (signal) => client.chat.completions.create(
          {
            model,
            temperature: context.playgroundOverrides?.routerTemperature ?? 0,
            max_tokens: 180,
            response_format: { type: "json_schema", json_schema: { name: "spark_route_decision", strict: true, schema: routerSchema } },
            messages: [
              { role: "system", content: context.playgroundOverrides?.routerSystemPrompt ?? routerPrompt(promptVersion) },
              ...toModelMessages(messages),
            ],
          },
          { signal, timeout: ROUTER_MODEL_TIMEOUT_MS, maxRetries: 0 },
        ),
      );
    } catch (error) {
      logSparkEvent("error", "routing.model.failed", {
        request_id: context.requestId,
        session_id: context.sessionId,
        scenario_id: context.scenarioId,
        model,
        duration_ms: Date.now() - startedAt,
        ...errorDetails(error),
      });
      throw error;
    }
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("The concierge returned no routing decision.");
    let route: RouteDecision;
    try {
      route = JSON.parse(content) as RouteDecision;
    } catch (error) {
      logSparkEvent("error", "routing.output.invalid", {
        request_id: context.requestId,
        session_id: context.sessionId,
        scenario_id: context.scenarioId,
        model,
        ...errorDetails(error),
      });
      throw error;
    }
    span.log({ input: messages.at(-1), output: route, metadata: { prompt_version: promptVersion } });
    logSparkEvent("info", "routing.model.completed", {
      request_id: context.requestId,
      session_id: context.sessionId,
      scenario_id: context.scenarioId,
      duration_ms: Date.now() - startedAt,
      specialist: route.specialist,
      confidence: route.confidence,
    });
    return route;
  }, { name: "support_concierge.route", type: "task" });
}

async function runSpecialist(client: OpenAI, messages: ChatMessage[], route: RouteDecision, context: AgentContext) {
  return traced(async (span) => {
    const toolsUsed: string[] = [];
    const attemptedTools = new Set<string>();
    const maxToolSteps = context.playgroundOverrides?.maxToolSteps ?? 3;
    let toolSteps = 0;
    const overridePrompt = context.playgroundOverrides?.specialistSystemPrompts?.[route.specialist];
    const baseSystemPrompt = overridePrompt
      ? overridePrompt.replaceAll("__SPARK_ROUTE_SUMMARY__", JSON.stringify(route))
      : specialistPrompt(route.specialist, JSON.stringify(route), context.promptVersion);
    const completedWork = [...new Set(context.completedTools ?? [])];
    const systemPrompt = completedWork.length
      ? `${baseSystemPrompt}\n\nCompleted tool operations from earlier turns: ${completedWork.join(", ")}. These checks have already happened. Use the results recorded in prior assistant messages when they are still applicable. Do not offer a completed operation as a future step unless the customer explicitly asks to refresh or rerun it, or a later action could have changed its result.`
      : baseSystemPrompt;
    const modelMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...toModelMessages(messages),
    ];

    for (let modelStep = 0; modelStep <= maxToolSteps; modelStep += 1) {
      const model = context.playgroundOverrides?.model ?? getSparkConfig().model;
      const toolsAvailable = toolSteps < maxToolSteps;
      const modelStartedAt = Date.now();
      logSparkEvent("info", "specialist.model.started", {
        request_id: context.requestId,
        session_id: context.sessionId,
        scenario_id: context.scenarioId,
        specialist: route.specialist,
        model,
        model_step: modelStep,
        tool_steps_used: toolSteps,
        max_tool_steps: maxToolSteps,
        tools_available: toolsAvailable,
      });
      let response;
      try {
        response = await withAbortTimeout(
          {
            operation: `${route.specialist} model request`,
            timeoutMs: SPECIALIST_MODEL_TIMEOUT_MS,
            parentSignal: context.requestSignal,
          },
          (signal) => client.chat.completions.create(
            {
              model,
              temperature: context.playgroundOverrides?.specialistTemperature ?? 0.2,
              max_tokens: 360,
              messages: modelMessages,
              ...(toolsAvailable
                ? { tools: toolsBySpecialist[route.specialist], tool_choice: "auto" as const }
                : {}),
            },
            { signal, timeout: SPECIALIST_MODEL_TIMEOUT_MS, maxRetries: 0 },
          ),
        );
      } catch (error) {
        logSparkEvent("error", "specialist.model.failed", {
          request_id: context.requestId,
          session_id: context.sessionId,
          scenario_id: context.scenarioId,
          specialist: route.specialist,
          model,
          model_step: modelStep,
          duration_ms: Date.now() - modelStartedAt,
          ...errorDetails(error),
        });
        throw error;
      }
      const assistant = response.choices[0]?.message;
      if (!assistant) throw new Error("The specialist returned no response.");
      modelMessages.push(assistant);
      logSparkEvent("info", "specialist.model.completed", {
        request_id: context.requestId,
        session_id: context.sessionId,
        scenario_id: context.scenarioId,
        specialist: route.specialist,
        duration_ms: Date.now() - modelStartedAt,
        model_step: modelStep,
        requested_tool_calls: assistant.tool_calls?.length ?? 0,
      });

      if (!assistant.tool_calls?.length) {
        const content = assistant.content?.trim() || "I’m sorry, I couldn’t complete that request.";
        span.log({
          input: route,
          output: { content, toolsUsed },
          metadata: { specialist: route.specialist, tool_steps_used: toolSteps, max_tool_steps: maxToolSteps },
        });
        logSparkEvent("info", "specialist.response.completed", {
          request_id: context.requestId,
          session_id: context.sessionId,
          scenario_id: context.scenarioId,
          specialist: route.specialist,
          tool_steps_used: toolSteps,
          response_characters: content.length,
        });
        return { content, toolsUsed };
      }

      for (const toolCall of assistant.tool_calls) {
        if (toolCall.type !== "function") continue;
        toolSteps += 1;
        const toolName = toolCall.function.name;
        const rawArguments = toolCall.function.arguments || "{}";
        let output: unknown;

        if (toolSteps > maxToolSteps) {
          output = { error: "tool_step_limit_reached", maxToolSteps };
          logSparkEvent("warn", "tool.skipped.limit", {
            request_id: context.requestId,
            session_id: context.sessionId,
            scenario_id: context.scenarioId,
            specialist: route.specialist,
            tool_name: toolName,
            tool_step: toolSteps,
            max_tool_steps: maxToolSteps,
          });
        } else {
          let args: Record<string, unknown> | undefined;
          try {
            const parsed = JSON.parse(rawArguments) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("Tool arguments must be a JSON object");
            }
            args = parsed as Record<string, unknown>;
          } catch (error) {
            output = { error: "malformed_tool_arguments", detail: error instanceof Error ? error.message : String(error) };
            logSparkEvent("warn", "tool.skipped.malformed_arguments", {
              request_id: context.requestId,
              session_id: context.sessionId,
              scenario_id: context.scenarioId,
              specialist: route.specialist,
              tool_name: toolName,
              tool_step: toolSteps,
              ...errorDetails(error),
            });
          }

          if (args) {
            const requiresConfirmation = toolName === "create_return_request" || toolName === "cancel_pending_order" || toolName === "escalate_to_human";
            if (requiresConfirmation && !hasExplicitActionConfirmation(messages, toolName)) {
              output = { error: "explicit_confirmation_required", action: toolName };
              logSparkEvent("warn", "tool.skipped.missing_confirmation", {
                request_id: context.requestId,
                session_id: context.sessionId,
                scenario_id: context.scenarioId,
                specialist: route.specialist,
                tool_name: toolName,
                tool_step: toolSteps,
              });
              modelMessages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(output) });
              continue;
            }
            if (toolName === "create_return_request" || toolName === "cancel_pending_order") args.confirmed = true;
            const fingerprint = `${toolName}:${JSON.stringify(args)}`;
            if (attemptedTools.has(fingerprint)) {
              output = { error: "repeated_tool_call", tool: toolName };
              logSparkEvent("warn", "tool.skipped.repeated", {
                request_id: context.requestId,
                session_id: context.sessionId,
                scenario_id: context.scenarioId,
                specialist: route.specialist,
                tool_name: toolName,
                tool_step: toolSteps,
              });
            } else {
              attemptedTools.add(fingerprint);
              const toolStartedAt = Date.now();
              logSparkEvent("info", "tool.execution.started", {
                request_id: context.requestId,
                session_id: context.sessionId,
                scenario_id: context.scenarioId,
                specialist: route.specialist,
                tool_name: toolName,
                tool_step: toolSteps,
              });
              try {
                output = await traced(
                  async (toolSpan) => {
                    const result = await withAbortTimeout(
                      {
                        operation: `tool ${toolName}`,
                        timeoutMs: TOOL_TIMEOUT_MS,
                        parentSignal: context.requestSignal,
                      },
                      (signal) => runTool(context.accountId, context.sessionId, toolName, args, signal),
                    );
                    toolSpan.log({ input: args, output: result, metadata: { session_id: context.sessionId, tool_step: toolSteps } });
                    return result;
                  },
                  { name: `tool.${toolName}`, type: "tool" },
                );
              } catch (error) {
                logSparkEvent("error", "tool.execution.failed", {
                  request_id: context.requestId,
                  session_id: context.sessionId,
                  scenario_id: context.scenarioId,
                  specialist: route.specialist,
                  tool_name: toolName,
                  tool_step: toolSteps,
                  duration_ms: Date.now() - toolStartedAt,
                  ...errorDetails(error),
                });
                throw error;
              }
              toolsUsed.push(toolName);
              logSparkEvent("info", "tool.execution.completed", {
                request_id: context.requestId,
                session_id: context.sessionId,
                scenario_id: context.scenarioId,
                specialist: route.specialist,
                tool_name: toolName,
                tool_step: toolSteps,
                duration_ms: Date.now() - toolStartedAt,
              });
            }
          }
        }

        modelMessages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(output) });
      }
    }

    const content = "I’ve reached the limit for this request. Please try again, or ask me to connect you with a support specialist.";
    logSparkEvent("warn", "specialist.response.tool_limit", {
      request_id: context.requestId,
      session_id: context.sessionId,
      scenario_id: context.scenarioId,
      specialist: route.specialist,
      tool_steps_used: toolSteps,
      max_tool_steps: maxToolSteps,
    });
    return { content, toolsUsed };
  }, { name: `agent.${route.specialist}`, type: "task" });
}

export async function runSupportTurn(
  messages: ChatMessage[],
  context: AgentContext,
  exportedRoot?: string,
  upstreamParent?: string | PropagationContext,
): Promise<SupportResult & { exportedRoot?: string }> {
  const config = getSparkConfig();
  const promptVersion = context.promptVersion ?? config.promptVersion;
  const model = context.playgroundOverrides?.model ?? config.model;
  const lastMessage = messages.at(-1)?.content ?? "";

  if (!config.braintrustApiKey) {
    const route = fallbackRoute(lastMessage);
    return { content: fallbackResponse(route), route, toolsUsed: [], exportedRoot };
  }

  const logger = initLogger({
    projectId: config.braintrustProjectId,
    apiKey: config.braintrustApiKey,
    appUrl: config.braintrustAppUrl,
    setCurrent: false,
  });

  let parent = exportedRoot;
  if (!parent) {
    if (upstreamParent) {
      await withAbortTimeout(
        {
          operation: "Braintrust distributed trace login",
          timeoutMs: TRACE_EXPORT_TIMEOUT_MS,
          parentSignal: context.requestSignal,
        },
        () => logger.id,
      );
    }
    const rootArgs = {
      name: "spark.support_conversation",
      type: "task",
      event: {
        input: { first_message: lastMessage },
        metadata: {
          conversation_id: context.sessionId,
          account_id: context.accountId,
          source: context.source,
          scenario_id: context.scenarioId,
          model,
          prompt_version: promptVersion,
          playground_override: Boolean(context.playgroundOverrides),
          distributed_parent: Boolean(upstreamParent),
          behavior_specs: ["preserve-action-intent-during-routing", "confirm-before-consequential-action"],
          app: "spark",
        },
      },
    } as const;
    const root = upstreamParent
      ? startSpan({ ...rootArgs, parent: upstreamParent, state: logger.loggingState })
      : logger.startSpan(rootArgs);
    try {
      parent = await withAbortTimeout(
        {
          operation: "Braintrust root span export",
          timeoutMs: TRACE_EXPORT_TIMEOUT_MS,
          parentSignal: context.requestSignal,
        },
        () => root.export(),
      );
      root.log({ output: { status: "active" } });
    } finally {
      root.end();
    }
  }

  const client = createClient();
  try {
    const result = await withAbortTimeout(
      {
        operation: "support conversation turn",
        timeoutMs: TURN_TIMEOUT_MS,
        parentSignal: context.requestSignal,
      },
      (turnSignal) => {
        const turnContext = { ...context, requestSignal: turnSignal };
        return withParent(parent, () => traced(async (turnSpan) => {
          logSparkEvent("info", "conversation.turn.started", {
            request_id: context.requestId,
            session_id: context.sessionId,
            scenario_id: context.scenarioId,
            turn_number: Math.ceil(messages.length / 2),
          });
          const route = await decideRoute(client, messages, turnContext);
          const specialist = await runSpecialist(client, messages, route, turnContext);
          const output = { content: specialist.content, route, toolsUsed: specialist.toolsUsed };
          turnSpan.log({ input: messages.at(-1), output, metadata: { turn_number: Math.ceil(messages.length / 2), conversation_id: context.sessionId } });
          logSparkEvent("info", "conversation.turn.completed", {
            request_id: context.requestId,
            session_id: context.sessionId,
            scenario_id: context.scenarioId,
            turn_number: Math.ceil(messages.length / 2),
            specialist: route.specialist,
            tool_count: specialist.toolsUsed.length,
          });
          return output;
        }, { name: "conversation.turn", type: "task" }));
      },
    );
    return { ...result, exportedRoot: parent };
  } catch (error) {
    logSparkEvent("error", "conversation.turn.failed", {
      request_id: context.requestId,
      session_id: context.sessionId,
      scenario_id: context.scenarioId,
      ...errorDetails(error),
    });
    throw error;
  } finally {
    try {
      await withAbortTimeout(
        { operation: "Braintrust trace flush", timeoutMs: TRACE_FLUSH_TIMEOUT_MS },
        () => logger.flush(),
      );
      logSparkEvent("info", "tracing.flush.completed", {
        request_id: context.requestId,
        session_id: context.sessionId,
        scenario_id: context.scenarioId,
      });
    } catch (error) {
      logSparkEvent("warn", "tracing.flush.failed", {
        request_id: context.requestId,
        session_id: context.sessionId,
        scenario_id: context.scenarioId,
        ...errorDetails(error),
      });
    }
  }
}
