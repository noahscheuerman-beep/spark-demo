export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type Specialist = "vehicle_charging" | "orders_returns" | "general_support";

export type RouteDecision = {
  specialist: Specialist;
  primaryIntent: string;
  requestedAction: string | null;
  secondaryIntent: string | null;
  confidence: number;
};

export type SupportResult = {
  content: string;
  route: RouteDecision;
  toolsUsed: string[];
};

export type AgentContext = {
  requestId: string;
  requestSignal: AbortSignal;
  sessionId: string;
  accountId: string;
  source: "interactive" | "seed" | "daily" | "playground";
  scenarioId?: string;
  promptVersion?: "baseline-v1" | "improved-v1" | "story-v2";
  completedTools?: string[];
  playgroundOverrides?: AgentPlaygroundOverrides;
};

export type AgentPlaygroundOverrides = {
  model?: string;
  routerSystemPrompt?: string;
  specialistSystemPrompts?: Partial<Record<Specialist, string>>;
  routerTemperature?: number;
  specialistTemperature?: number;
  maxToolSteps?: number;
};
