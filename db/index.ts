import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady = false;

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export async function ensureDb() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (schemaReady) return;

  // Never cache an in-flight D1 Promise at module scope. Cloudflare I/O is
  // request-scoped, and sharing that Promise can strand concurrent requests.
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, root_span_parent TEXT, prompt_version TEXT NOT NULL, model TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'interactive', scenario_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages (session_id, id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS conversation_tool_events (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, session_id TEXT NOT NULL, tool_name TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_conversation_tool_events_session_id ON conversation_tool_events (session_id, id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS return_requests (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, order_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_return_requests_session_id ON return_requests (session_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS demo_accounts (id TEXT PRIMARY KEY NOT NULL, credits_cents INTEGER NOT NULL, scenario TEXT NOT NULL, charger_status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS demo_orders (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, product_id TEXT NOT NULL, item TEXT NOT NULL, price_cents INTEGER NOT NULL, status TEXT NOT NULL, delivered_days_ago INTEGER, return_eligible INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_demo_orders_account_created ON demo_orders (account_id, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS demo_orders_v2 (id TEXT PRIMARY KEY NOT NULL, order_number TEXT NOT NULL, account_id TEXT NOT NULL, product_id TEXT NOT NULL, item TEXT NOT NULL, price_cents INTEGER NOT NULL, status TEXT NOT NULL, delivered_days_ago INTEGER, return_eligible INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_demo_orders_v2_account_created ON demo_orders_v2 (account_id, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS charging_sessions (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, energy_wh INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_charging_sessions_account_started ON charging_sessions (account_id, started_at)"),
    env.DB.prepare("PRAGMA optimize"),
  ]);
  schemaReady = true;
}
