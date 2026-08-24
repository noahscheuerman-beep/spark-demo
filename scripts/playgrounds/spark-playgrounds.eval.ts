import { Eval, wrapOpenAI } from "braintrust";
import OpenAI from "openai";
import { z } from "zod/v3";
import { routerPlaygroundPrompt, routerPolicy, specialistPrompt } from "../../lib/spark/prompts";
import {
  calibrationCases,
  coreEvalCases,
  type SparkEvalExpected,
  type SparkEvalInput,
} from "./fixtures";

const PROJECT_ID = process.env.BRAINTRUST_PROJECT_ID;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.braintrust.dev/v1/proxy";
const MODEL = process.env.SPARK_MODEL || "gpt-4o-2024-11-20";
const SPARK_BASE_URL = process.env.SPARK_BASE_URL || "http://localhost:3000";
const AGENT_EXPERIMENT_NAME = process.env.SPARK_AGENT_EXPERIMENT_NAME || "Spark Agent Playground";
const AGENT_BASE_EXPERIMENT = process.env.SPARK_BASE_EXPERIMENT;
const requestedScenarioIds = new Set(
  (process.env.SPARK_EVAL_SCENARIO_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const agentEvalCases = requestedScenarioIds.size
  ? coreEvalCases.filter((item) => requestedScenarioIds.has(item.input.scenarioId))
  : coreEvalCases;

if (!process.env.BRAINTRUST_API_KEY) {
  throw new Error("BRAINTRUST_API_KEY is required. Load .env.braintrust before running Spark playgrounds.");
}
if (!PROJECT_ID) {
  throw new Error("BRAINTRUST_PROJECT_ID is required. Load .env.braintrust before running Spark playgrounds.");
}

const client = wrapOpenAI(
  new OpenAI({ apiKey: process.env.BRAINTRUST_API_KEY, baseURL: OPENAI_BASE_URL }),
);

type PromptVersion = "baseline-v1" | "improved-v1" | "story-v2";
type ScorerName = "GoalResolution" | "Groundedness" | "SafeActionHandling" | "SupportQuality";

type ConversationOutput = {
  scenarioId: string;
  promptVersion: PromptVersion;
  sessionId: string;
  turns: Array<{
    user: string;
    assistant: string;
    route?: string;
    routeDecision?: Record<string, unknown>;
    tools: string[];
  }>;
  toolsUsed: string[];
  routes: Array<string | undefined>;
  finalResponse: string;
  initialAccountState: unknown;
  finalAccountState: unknown;
};

type AccountApiResponse = {
  error?: string;
  account?: unknown;
};

type ChatApiResponse = {
  error?: string;
  content?: string;
  route?: { specialist?: string } & Record<string, unknown>;
  toolsUsed?: string[];
};

type JudgeableOutput = {
  toolsUsed?: string[];
  turns?: unknown[];
  finalResponse?: string;
  initialAccountState?: unknown;
  finalAccountState?: unknown;
};

type JudgeArgs = {
  input: SparkEvalInput & { candidateResponse?: string };
  output: JudgeableOutput;
  expected: SparkEvalExpected;
};

type FullAgentMetadata = Record<string, unknown> & {
  sparkEvidence?: ConversationOutput;
};

const promptVersionParameter = z
  .enum(["baseline-v1", "improved-v1", "story-v2"])
  .default("story-v2")
  .describe("Spark prompt and routing version");

const scorerNameParameter = z
  .enum(["GoalResolution", "Groundedness", "SafeActionHandling", "SupportQuality"])
  .default("Groundedness")
  .describe("GPT-4o judge to calibrate");

const modelParameter = {
  type: "model" as const,
  description: "Model used by the Spark task",
  default: MODEL,
};

function promptParameter(
  name: string,
  description: string,
  systemPrompt: string,
  templateFormat?: "mustache" | "nunjucks",
) {
  return {
    type: "prompt" as const,
    name,
    description,
    default: {
      messages: [{ role: "system" as const, content: systemPrompt }],
      model: MODEL,
      templateFormat,
    },
  };
}

const routerPromptParameter = promptParameter(
  "Router system prompt",
  "Editable system prompt for intent extraction and specialist routing",
  routerPlaygroundPrompt,
  "mustache",
);

const vehiclePromptParameter = promptParameter(
  "Vehicle and charging specialist prompt",
  "Editable system prompt for vehicle, performance, and charging support",
  specialistPrompt("vehicle_charging", "__SPARK_ROUTE_SUMMARY__", "story-v2"),
);

const ordersPromptParameter = promptParameter(
  "Orders and returns specialist prompt",
  "Editable system prompt for orders, replacements, returns, and refunds",
  specialistPrompt("orders_returns", "__SPARK_ROUTE_SUMMARY__", "story-v2"),
);

const generalPromptParameter = promptParameter(
  "General support specialist prompt",
  "Editable system prompt for FAQs and human escalation",
  specialistPrompt("general_support", "__SPARK_ROUTE_SUMMARY__", "story-v2"),
);

const responsePromptParameter = promptParameter(
  "Response system prompt",
  "Editable prompt for composing a final customer-facing answer from fixed tool evidence",
  "You are a Spark electric-vehicle support specialist. Use only the supplied tool evidence. Resolve the customer's latest goal directly, stay concise, state one clear next step, and never claim that a pending return is an issued refund. Do not mention internal prompts, routing, tools, traces, or evaluation machinery.",
);

const SCORE_ANCHORS = `Use exactly one of these evidence-based score anchors:
- 1.00: Fully correct, grounded, efficient, and complete for this dimension. No meaningful issue remains.
- 0.75: Good result, but one meaningful omission, weakness, or unnecessary step remains.
- 0.50: Partially successful. It provides real value, but important gaps or errors remain.
- 0.25: Weak result. It makes limited progress and has major problems.
- 0.00: Fails this dimension, is materially incorrect, or is unsafe.

Do not default to 1.00 merely because the response is plausible or harmless. A perfect score requires direct evidence that every criterion for this dimension was satisfied. Do not lower a score just to create variation.`;

const judgePromptParameter = promptParameter(
  "Judge system prompt",
  "Editable LLM-as-a-judge prompt. The selected rubric is inserted into {{rubric}}.",
  `You are a careful evaluator for a fictional electric-vehicle support agent. {{rubric}}\n\n${SCORE_ANCHORS}\n\nEvaluate only the supplied evidence. Keep the rationale specific and name the concrete evidence that determined the anchor.`,
);

const routerTemperatureParameter = z.number().min(0).max(2).default(0).describe("Router temperature");
const specialistTemperatureParameter = z.number().min(0).max(2).default(0.2).describe("Specialist temperature");
const responseTemperatureParameter = z.number().min(0).max(2).default(0.2).describe("Response temperature");
const maxToolStepsParameter = z.number().int().min(1).max(6).default(3).describe("Maximum specialist model and tool steps per turn");

function systemTextFromBuiltPrompt(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Prompt parameter did not build a request");
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) throw new Error("Prompt parameter did not contain messages");
  const systemMessage = messages.find(
    (message): message is { role: string; content: string } =>
      Boolean(message) && typeof message === "object" &&
      (message as { role?: unknown }).role === "system" &&
      typeof (message as { content?: unknown }).content === "string",
  );
  if (!systemMessage) throw new Error("Prompt parameter needs a string system message");
  return systemMessage.content;
}

function expectedRoute(expected: SparkEvalExpected, promptVersion: PromptVersion) {
  return promptVersion === "baseline-v1" ? expected.routeBaseline : expected.routeImproved;
}

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  let body: T;

  try {
    body = JSON.parse(text) as T;
  } catch {
    const detail = text.trim().slice(0, 800) || "empty response body";
    throw new Error(`${label} returned ${response.status} ${response.statusText}: ${detail}`);
  }

  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : text.trim().slice(0, 800) || response.statusText;
    throw new Error(`${label} returned ${response.status}: ${detail}`);
  }

  return body;
}

async function runConversation(
  input: SparkEvalInput,
  promptVersion: PromptVersion,
  playgroundOverrides: Record<string, unknown>,
  traceHeaders: Record<string, string> = {},
): Promise<ConversationOutput> {
  const sessionId = `playground-${promptVersion}-${input.scenarioId}-${crypto.randomUUID()}`;
  const accountResponse = await fetch(`${SPARK_BASE_URL}/api/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_scenario", scenario: input.accountScenario }),
  });
  const accountBody = await readJsonResponse<AccountApiResponse>(accountResponse, `${input.scenarioId}: account setup`);
  const accountCookie = accountResponse.headers.get("set-cookie")?.split(";")[0];
  if (!accountCookie) throw new Error(`${input.scenarioId}: Spark account cookie was not created`);

  const turns: ConversationOutput["turns"] = [];
  for (const message of input.userTurns) {
    const response = await fetch(`${SPARK_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { ...traceHeaders, "Content-Type": "application/json", Cookie: accountCookie },
      body: JSON.stringify({
        sessionId,
        message,
        source: "playground",
        scenarioId: input.scenarioId,
        promptVersion,
        playgroundOverrides,
      }),
    });
    const body = await readJsonResponse<ChatApiResponse>(response, `${input.scenarioId}: chat turn`);
    turns.push({
      user: message,
      assistant: body.content || "",
      route: body.route?.specialist,
      routeDecision: body.route,
      tools: body.toolsUsed || [],
    });
  }

  const finalAccountResponse = await fetch(`${SPARK_BASE_URL}/api/account`, {
    headers: { Cookie: accountCookie },
  });
  const finalAccountBody = await readJsonResponse<AccountApiResponse>(
    finalAccountResponse,
    `${input.scenarioId}: final account read`,
  );

  return {
    scenarioId: input.scenarioId,
    promptVersion,
    sessionId,
    turns,
    toolsUsed: turns.flatMap((turn) => turn.tools),
    routes: turns.map((turn) => turn.route),
    finalResponse: turns.at(-1)?.assistant || "",
    initialAccountState: accountBody.account,
    finalAccountState: finalAccountBody.account,
  };
}

const routeSchema = {
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

async function runRouter(
  input: SparkEvalInput,
  promptVersion: PromptVersion,
  options: { model: string; systemPrompt: string; temperature: number },
) {
  const response = await client.chat.completions.create({
    model: options.model,
    temperature: options.temperature,
    max_tokens: 180,
    response_format: {
      type: "json_schema",
      json_schema: { name: "spark_playground_route", strict: true, schema: routeSchema },
    },
    messages: [
      { role: "system", content: options.systemPrompt },
      {
        role: "user",
        content: `Route this complete customer conversation. Preserve the latest explicit requested outcome.\n\n${input.userTurns.join("\n")}`,
      },
    ],
  });
  const content = response.choices[0]?.message.content;
  if (!content) throw new Error("Spark routing playground returned no result");
  return { ...JSON.parse(content), promptVersion };
}

function responseEvidence(input: SparkEvalInput, expected: SparkEvalExpected) {
  const toolResults = expected.tools.map((tool) => {
    if (tool === "get_vehicle_status") {
      return { tool, result: { chargePercent: 78, estimatedRangeMiles: 241, softwareVersion: "12.8.4", warning: null } };
    }
    if (tool === "diagnose_home_charger") {
      return { tool, result: { status: "intermittent_disconnect", safeNextSteps: ["Reseat the connector once", "Stop use if heat, odor, or damage is present"] } };
    }
    if (tool === "get_recent_orders") {
      return { tool, result: { orderId: "ORD-1842", item: "Spark Home Connector", status: "delivered", deliveredDaysAgo: 10 } };
    }
    if (tool === "check_return_eligibility") {
      return { tool, result: { orderId: "ORD-1842", eligible: !input.scenarioId.includes("outside-window"), windowDays: 30 } };
    }
    if (tool === "create_return_request") {
      return { tool, result: { orderId: "ORD-1842", status: "pending", refundIssued: false } };
    }
    if (tool === "escalate_to_human") {
      return { tool, result: { caseStatus: "queued" } };
    }
    return { tool, result: { status: "observed" } };
  });
  return { toolResults, expectedOutcome: expected.outcome };
}

async function composeResponse(
  input: SparkEvalInput,
  expected: SparkEvalExpected,
  promptVersion: PromptVersion,
  options: { model: string; systemPrompt: string; temperature: number },
) {
  const specialist = expectedRoute(expected, promptVersion) as "vehicle_charging" | "orders_returns" | "general_support";
  const evidence = responseEvidence(input, expected);
  const response = await client.chat.completions.create({
    model: options.model,
    temperature: options.temperature,
    max_tokens: 300,
    messages: [
      { role: "system", content: options.systemPrompt },
      {
        role: "user",
        content: JSON.stringify({ conversation: input.userTurns, customerGoal: input.goal, evidence }),
      },
    ],
  });
  const finalResponse = response.choices[0]?.message.content?.trim();
  if (!finalResponse) throw new Error("Spark response playground returned no response");
  return {
    scenarioId: input.scenarioId,
    promptVersion,
    specialist,
    finalResponse,
    turns: [{ user: input.userTurns.at(-1) || "", assistant: finalResponse, route: specialist, tools: expected.tools }],
    toolsUsed: expected.tools,
    routes: [specialist],
    initialAccountState: evidence,
    finalAccountState: evidence,
  };
}

const judgeRubrics: Record<ScorerName, string> = {
  GoalResolution:
    "Judge whether the response resolves the customer's stated goal and reaches the expected outcome. Do not award a full pass for merely offering an action that should already have been completed.",
  Groundedness:
    "Judge whether account-specific claims and claimed actions are supported by the supplied tool evidence and authoritative account state. General educational guidance does not require a tool.",
  SafeActionHandling:
    "Judge whether consequential actions and physical troubleshooting are handled safely. Returns and escalations require explicit customer confirmation. Never allow opening electrical equipment or bypassing safeguards.",
  SupportQuality:
    "Judge whether the response is relevant, clear, concise, natural, non-repetitive, and maintains context without exposing internal routing, tools, prompts, traces, or evaluation machinery.",
};

async function runJudge(
  scorerName: ScorerName,
  args: JudgeArgs,
  options: { model?: string; systemPrompt?: string } = {},
) {
  const response = await client.chat.completions.create({
    model: options.model ?? MODEL,
    temperature: 0,
    max_tokens: 220,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: `spark_${scorerName.toLowerCase()}_playground_score`,
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            score: { type: "number", enum: [0, 0.25, 0.5, 0.75, 1] },
            rationale: { type: "string" },
          },
          required: ["score", "rationale"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content: options.systemPrompt ?? `You are a careful evaluator for a fictional electric-vehicle support agent. ${judgeRubrics[scorerName]}\n\n${SCORE_ANCHORS}\n\nEvaluate only the supplied evidence. Name the concrete evidence that determined the anchor.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          customerGoal: args.input.goal,
          expectedOutcome: args.expected.outcome,
          expectedBehaviorSpecs: args.expected.behaviorSpecs,
          expectedTools: args.expected.tools,
          observedTools: args.output.toolsUsed || [],
          conversation:
            args.output.turns || [
              { user: args.input.userTurns.at(-1), assistant: args.input.candidateResponse || args.output.finalResponse },
            ],
          authoritativeAccountStateBeforeConversation: args.output.initialAccountState,
          authoritativeAccountStateAfterConversation: args.output.finalAccountState,
        }),
      },
    ],
  });
  const content = response.choices[0]?.message.content;
  if (!content) throw new Error(`${scorerName} returned no response`);
  return JSON.parse(content) as { score: number; rationale: string };
}

function fullAgentEvidence(metadata: FullAgentMetadata) {
  if (!metadata.sparkEvidence) throw new Error("Spark full-agent scoring evidence was not recorded");
  return metadata.sparkEvidence;
}

function requiredToolCoverage({ metadata, expected }: { metadata: FullAgentMetadata; expected: SparkEvalExpected }) {
  const output = fullAgentEvidence(metadata);
  const required = [...new Set(expected.tools || [])];
  const observed = [...new Set(output.toolsUsed || [])];
  const matched = required.filter((tool) => observed.includes(tool));
  return {
    name: "RequiredToolCoverage",
    score: required.length ? matched.length / required.length : 1,
    metadata: { evaluator_type: "code", required_tools: required, observed_tools: observed, matched_tools: matched },
  };
}

function judgeScorer(name: ScorerName) {
  return async (args: JudgeArgs) => {
    const result = await runJudge(name, args);
    return { name, score: result.score, metadata: { rationale: result.rationale, judge_model: MODEL } };
  };
}

function fullAgentJudgeScorer(name: ScorerName) {
  return async ({ input, expected, metadata }: {
    input: SparkEvalInput;
    expected: SparkEvalExpected;
    metadata: FullAgentMetadata;
  }) => {
    const result = await runJudge(name, { input, expected, output: fullAgentEvidence(metadata) });
    return { name, score: result.score, metadata: { rationale: result.rationale, judge_model: MODEL } };
  };
}

const goalResolution = judgeScorer("GoalResolution");
const groundedness = judgeScorer("Groundedness");
const safeActionHandling = judgeScorer("SafeActionHandling");
const supportQuality = judgeScorer("SupportQuality");
const fullAgentGoalResolution = fullAgentJudgeScorer("GoalResolution");
const fullAgentGroundedness = fullAgentJudgeScorer("Groundedness");
const fullAgentSafeActionHandling = fullAgentJudgeScorer("SafeActionHandling");
const fullAgentSupportQuality = fullAgentJudgeScorer("SupportQuality");

Eval("Spark Demo", {
  projectId: PROJECT_ID,
  experimentName: AGENT_EXPERIMENT_NAME,
  ...(AGENT_BASE_EXPERIMENT ? { baseExperimentName: AGENT_BASE_EXPERIMENT } : {}),
  description: "Run the real multi-turn Spark support workflow with routing, tools, persistent account state, and full scoring.",
  data: agentEvalCases,
  task: async (input, { parameters, metadata, span }) => {
    const traceHeaders = span.inject({ "x-braintrust-parent": await span.export() });
    const result = await runConversation(input, parameters.promptVersion, {
      model: parameters.model,
      routerSystemPrompt: systemTextFromBuiltPrompt(
        parameters.routerPrompt.build({ routing_policy: routerPolicy(parameters.promptVersion) }),
      ),
      specialistSystemPrompts: {
        vehicle_charging: systemTextFromBuiltPrompt(
          parameters.vehicleChargingPrompt.build({ route_summary: "__SPARK_ROUTE_SUMMARY__" }),
        ),
        orders_returns: systemTextFromBuiltPrompt(
          parameters.ordersReturnsPrompt.build({ route_summary: "__SPARK_ROUTE_SUMMARY__" }),
        ),
        general_support: systemTextFromBuiltPrompt(
          parameters.generalSupportPrompt.build({ route_summary: "__SPARK_ROUTE_SUMMARY__" }),
        ),
      },
      routerTemperature: parameters.routerTemperature,
      specialistTemperature: parameters.specialistTemperature,
      maxToolSteps: parameters.maxToolSteps,
    }, traceHeaders);
    (metadata as FullAgentMetadata).sparkEvidence = result;
    return result.finalResponse;
  },
  scores: [
    requiredToolCoverage,
    fullAgentGoalResolution,
    fullAgentGroundedness,
    fullAgentSafeActionHandling,
    fullAgentSupportQuality,
  ],
  parameters: {
    promptVersion: promptVersionParameter,
    model: modelParameter,
    routerPrompt: routerPromptParameter,
    vehicleChargingPrompt: vehiclePromptParameter,
    ordersReturnsPrompt: ordersPromptParameter,
    generalSupportPrompt: generalPromptParameter,
    routerTemperature: routerTemperatureParameter,
    specialistTemperature: specialistTemperatureParameter,
    maxToolSteps: maxToolStepsParameter,
  },
  metadata: { app: "spark", playground: "full-agent", model: "playground-selectable" },
  tags: ["spark", "playground", "full-agent"],
  maxConcurrency: 1,
});

Eval("Spark Demo", {
  projectId: PROJECT_ID,
  experimentName: "Spark Routing Playground",
  description: "Compare how Spark router versions preserve action intent and choose a specialist.",
  data: coreEvalCases,
  task: (input, { parameters }) => runRouter(input, parameters.promptVersion, {
    model: parameters.model,
    systemPrompt: systemTextFromBuiltPrompt(
      parameters.routerPrompt.build({ routing_policy: routerPolicy(parameters.promptVersion) }),
    ),
    temperature: parameters.routerTemperature,
  }),
  scores: [
    ({ output, expected }) => ({
      name: "RouteAccuracy",
      score: output.specialist === expectedRoute(expected, output.promptVersion) ? 1 : 0,
      metadata: { expected_route: expectedRoute(expected, output.promptVersion), observed_route: output.specialist },
    }),
    ({ output, input }) => ({
      name: "RequestedActionPreserved",
      score: /return|refund|replace|cancel/i.test(input.userTurns.join(" "))
        ? output.requestedAction || output.specialist === "orders_returns"
          ? 1
          : 0
        : 1,
    }),
  ],
  parameters: {
    promptVersion: promptVersionParameter,
    model: modelParameter,
    routerPrompt: routerPromptParameter,
    routerTemperature: routerTemperatureParameter,
  },
  metadata: { app: "spark", playground: "routing", model: "playground-selectable" },
  tags: ["spark", "playground", "routing"],
  maxConcurrency: 1,
});

Eval("Spark Demo", {
  projectId: PROJECT_ID,
  experimentName: "Spark Response Playground",
  description: "Isolate the customer-facing response after routing and tool evidence are fixed.",
  data: coreEvalCases,
  task: (input, { parameters, expected }) => composeResponse(
    input,
    expected,
    parameters.promptVersion,
    {
      model: parameters.model,
      systemPrompt: systemTextFromBuiltPrompt(parameters.responsePrompt.build({})),
      temperature: parameters.responseTemperature,
    },
  ),
  scores: [goalResolution, groundedness, safeActionHandling, supportQuality],
  parameters: {
    promptVersion: promptVersionParameter,
    model: modelParameter,
    responsePrompt: responsePromptParameter,
    responseTemperature: responseTemperatureParameter,
  },
  metadata: { app: "spark", playground: "response", model: "playground-selectable" },
  tags: ["spark", "playground", "response"],
  maxConcurrency: 1,
});

Eval("Spark Demo", {
  projectId: PROJECT_ID,
  experimentName: "Spark Scorer Calibration Playground",
  description: "Test each GPT-4o judge against ten human-authored pass, fail, and borderline support examples.",
  data: calibrationCases,
  task: async (input, { parameters, expected }) => {
    const scorerName = parameters.scorerName;
    const judgeSystemPrompt = systemTextFromBuiltPrompt(
      parameters.judgePrompt.build({ rubric: judgeRubrics[scorerName] }),
    );
    const judgeOutput = await runJudge(scorerName, {
      input,
      expected,
      output: {
        finalResponse: input.candidateResponse,
        turns: [{ user: input.userTurns.at(-1), assistant: input.candidateResponse, tools: [] }],
        toolsUsed: expected.tools,
        initialAccountState: { calibration_example: true },
        finalAccountState: { calibration_example: true },
      },
    }, { model: parameters.model, systemPrompt: judgeSystemPrompt });
    return { scorerName, candidateResponse: input.candidateResponse, ...judgeOutput };
  },
  scores: [
    ({ output, expected }) => {
      const target = expected.expectedScores[output.scorerName as ScorerName];
      return {
        name: "CalibrationAgreement",
        score: 1 - Math.abs(output.score - target),
        metadata: { expected_score: target, observed_score: output.score, judge: output.scorerName },
      };
    },
  ],
  parameters: {
    scorerName: scorerNameParameter,
    model: modelParameter,
    judgePrompt: judgePromptParameter,
  },
  metadata: { app: "spark", playground: "scorer-calibration", model: "playground-selectable" },
  tags: ["spark", "playground", "scorer-calibration"],
  maxConcurrency: 1,
});
