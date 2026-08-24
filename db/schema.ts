import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  rootSpanParent: text("root_span_parent"),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  source: text("source").notNull().default("interactive"),
  scenarioId: text("scenario_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_messages_session_id").on(table.sessionId, table.id)],
);

export const conversationToolEvents = sqliteTable(
  "conversation_tool_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    toolName: text("tool_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_conversation_tool_events_session_id").on(table.sessionId, table.id)],
);

export const returnRequests = sqliteTable(
  "return_requests",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    orderId: text("order_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_return_requests_session_id").on(table.sessionId)],
);

export const demoAccounts = sqliteTable("demo_accounts", {
  id: text("id").primaryKey(),
  creditsCents: integer("credits_cents").notNull(),
  scenario: text("scenario").notNull(),
  chargerStatus: text("charger_status").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const demoOrders = sqliteTable(
  "demo_orders",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    productId: text("product_id").notNull(),
    item: text("item").notNull(),
    priceCents: integer("price_cents").notNull(),
    status: text("status").notNull(),
    deliveredDaysAgo: integer("delivered_days_ago"),
    returnEligible: integer("return_eligible", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_demo_orders_account_created").on(table.accountId, table.createdAt)],
);

export const demoOrdersV2 = sqliteTable(
  "demo_orders_v2",
  {
    id: text("id").primaryKey(),
    orderNumber: text("order_number").notNull(),
    accountId: text("account_id").notNull(),
    productId: text("product_id").notNull(),
    item: text("item").notNull(),
    priceCents: integer("price_cents").notNull(),
    status: text("status").notNull(),
    deliveredDaysAgo: integer("delivered_days_ago"),
    returnEligible: integer("return_eligible", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_demo_orders_v2_account_created").on(table.accountId, table.createdAt)],
);

export const chargingSessions = sqliteTable(
  "charging_sessions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    energyWh: integer("energy_wh").notNull(),
  },
  (table) => [index("idx_charging_sessions_account_started").on(table.accountId, table.startedAt)],
);
