import { asc, eq } from "drizzle-orm";
import { extractTraceContextFromHeaders } from "braintrust";
import { ensureDb, getDb } from "../../../db";
import { conversationToolEvents, messages, sessions } from "../../../db/schema";
import { runSupportTurn } from "../../../lib/spark/agent";
import { attachAccountCookie, ensureSparkAccount, resolveAccount } from "../../../lib/spark/account";
import { getSparkConfig } from "../../../lib/spark/config";
import { errorDetails, logSparkEvent, SparkOperationTimeoutError, withAbortTimeout } from "../../../lib/spark/runtime";
import type { AgentPlaygroundOverrides, ChatMessage } from "../../../lib/spark/types";

const CHAT_REQUEST_TIMEOUT_MS = 75_000;

type ChatRequest = {
  sessionId?: string;
  message?: string;
  source?: "interactive" | "seed" | "daily" | "playground";
  scenarioId?: string;
  promptVersion?: "baseline-v1" | "improved-v1" | "story-v2";
  playgroundOverrides?: AgentPlaygroundOverrides;
};

function playgroundOverridesFor(payload: ChatRequest, source: NonNullable<ChatRequest["source"]>) {
  if (source !== "playground" || !payload.playgroundOverrides) return undefined;
  const overrides = payload.playgroundOverrides;
  return {
    model: overrides.model?.slice(0, 200),
    routerSystemPrompt: overrides.routerSystemPrompt?.slice(0, 30_000),
    specialistSystemPrompts: overrides.specialistSystemPrompts,
    routerTemperature: typeof overrides.routerTemperature === "number"
      ? Math.min(2, Math.max(0, overrides.routerTemperature))
      : undefined,
    specialistTemperature: typeof overrides.specialistTemperature === "number"
      ? Math.min(2, Math.max(0, overrides.specialistTemperature))
      : undefined,
    maxToolSteps: typeof overrides.maxToolSteps === "number"
      ? Math.min(6, Math.max(1, Math.round(overrides.maxToolSteps)))
      : undefined,
  } satisfies AgentPlaygroundOverrides;
}

async function handleChatPost(request: Request, requestId: string, requestSignal: AbortSignal) {
    const startedAt = Date.now();
    const payload = (await request.json()) as ChatRequest;
    const sessionId = payload.sessionId?.trim() || crypto.randomUUID();
    const message = payload.message?.trim() || "";
    const source = payload.source ?? "interactive";
    const exportedEvalParent = source === "interactive"
      ? undefined
      : request.headers.get("x-braintrust-parent") ?? undefined;
    const upstreamTraceContext = exportedEvalParent ?? extractTraceContextFromHeaders(request.headers);
    const requestedPromptVersion = payload.promptVersion;
    const playgroundOverrides = playgroundOverridesFor(payload, source);

    logSparkEvent("info", "request.received", {
      request_id: requestId,
      session_id: sessionId,
      scenario_id: payload.scenarioId,
      source,
      prompt_version: requestedPromptVersion,
      message_characters: message.length,
      distributed_trace_context: Boolean(upstreamTraceContext),
      distributed_trace_format: exportedEvalParent ? "exported_span" : upstreamTraceContext ? "w3c" : "none",
    });

    if (!message) {
      logSparkEvent("warn", "request.rejected", { request_id: requestId, session_id: sessionId, reason: "missing_message" });
      return Response.json({ error: "message is required", code: "invalid_request", requestId }, { status: 400 });
    }
    if (message.length > 2000) {
      logSparkEvent("warn", "request.rejected", { request_id: requestId, session_id: sessionId, reason: "message_too_long" });
      return Response.json({ error: "message must be 2,000 characters or fewer", code: "invalid_request", requestId }, { status: 400 });
    }

    const config = getSparkConfig();
    if (!config.braintrustApiKey || !config.braintrustProjectId) {
      logSparkEvent("warn", "request.rejected", {
        request_id: requestId,
        session_id: sessionId,
        reason: "missing_server_configuration",
      });
      return Response.json(
        {
          error: "Spark chat is not configured. Add your own Braintrust API key and project ID to the server environment.",
          code: "configuration_required",
          requestId,
        },
        { status: 503 },
      );
    }

    requestSignal.throwIfAborted();
    await ensureDb();
    const { accountId, setCookie } = resolveAccount(request);
    const account = await ensureSparkAccount(accountId);
    const db = getDb();
    const promptVersion = requestedPromptVersion === "story-v2" || requestedPromptVersion === "improved-v1" || requestedPromptVersion === "baseline-v1"
      ? requestedPromptVersion
      : config.promptVersion as "baseline-v1" | "improved-v1" | "story-v2";
    const now = Date.now();
    const existing = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

    if (!existing[0]) {
      await db.insert(sessions).values({
        id: sessionId,
        rootSpanParent: null,
        promptVersion,
        model: playgroundOverrides?.model ?? config.model,
        source,
        scenarioId: payload.scenarioId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert(messages).values({ sessionId, role: "user", content: message, createdAt: now });
    const historyRows = await db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.id));
    const priorToolRows = await db.select().from(conversationToolEvents).where(eq(conversationToolEvents.sessionId, sessionId)).orderBy(asc(conversationToolEvents.id));
    const history: ChatMessage[] = historyRows.map((row) => ({ role: row.role, content: row.content }));
    const session = existing[0] ?? (await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1))[0];
    requestSignal.throwIfAborted();
    const result = await runSupportTurn(
      history,
      {
        requestId,
        requestSignal,
        sessionId,
        accountId,
        source,
        scenarioId: payload.scenarioId ?? account.scenario,
        promptVersion: session.promptVersion as "baseline-v1" | "improved-v1" | "story-v2",
        completedTools: priorToolRows.map((row) => row.toolName),
        playgroundOverrides,
      },
      session?.rootSpanParent ?? undefined,
      upstreamTraceContext,
    );

    requestSignal.throwIfAborted();
    await db.insert(messages).values({ sessionId, role: "assistant", content: result.content, createdAt: Date.now() });
    if (result.toolsUsed.length) {
      await db.insert(conversationToolEvents).values(
        result.toolsUsed.map((toolName) => ({ sessionId, toolName, createdAt: Date.now() })),
      );
    }
    requestSignal.throwIfAborted();
    await db.update(sessions).set({ rootSpanParent: result.exportedRoot, updatedAt: Date.now() }).where(eq(sessions.id, sessionId));

    const response = attachAccountCookie(
      Response.json({ sessionId, content: result.content, route: result.route, toolsUsed: result.toolsUsed, traced: Boolean(config.braintrustApiKey) }),
      accountId,
      setCookie,
    );
    logSparkEvent("info", "response.completed", {
      request_id: requestId,
      session_id: sessionId,
      scenario_id: payload.scenarioId,
      status: response.status,
      duration_ms: Date.now() - startedAt,
      specialist: result.route.specialist,
      tool_count: result.toolsUsed.length,
    });
    return response;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    return await withAbortTimeout(
      {
        operation: "Spark chat request",
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
        parentSignal: request.signal,
      },
      (signal) => handleChatPost(request, requestId, signal),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected support error";
    const timedOut = error instanceof SparkOperationTimeoutError;
    const aborted = error instanceof Error && error.name === "AbortError";
    const status = timedOut ? 504 : aborted ? 499 : 500;
    logSparkEvent("error", "response.failed", {
      request_id: requestId,
      status,
      ...errorDetails(error),
    });
    return Response.json(
      {
        error: message,
        code: timedOut ? "request_timeout" : aborted ? "request_aborted" : "support_error",
        requestId,
        retryable: timedOut || aborted,
      },
      { status },
    );
  }
}
