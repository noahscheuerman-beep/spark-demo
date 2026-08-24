import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { chargingSessions, demoAccounts, demoOrdersV2 as demoOrders, returnRequests } from "../../db/schema";
import { sparkProducts, type SparkScenario } from "./catalog";

export type SparkOrder = {
  id: string;
  productId: string;
  item: string;
  priceCents: number;
  status: string;
  deliveredDaysAgo: number | null;
  returnEligible: boolean;
  createdAt: number;
};

export type SparkAccountSnapshot = {
  id: string;
  creditsCents: number;
  scenario: SparkScenario;
  chargerStatus: string;
  vehicle: {
    model: string;
    modelYear: number;
    trim: string;
    chargePercent: number;
    estimatedRangeMiles: number;
    softwareVersion: string;
    warrantyStatus: string;
  };
  latestCharging: null | {
    id: string;
    status: string;
    startedAt: number;
    endedAt: number | null;
    energyWh: number;
  };
  orders: SparkOrder[];
};

const vehicle = {
  model: "Spark One",
  modelYear: 2026,
  trim: "Silverline",
  chargePercent: 78,
  estimatedRangeMiles: 241,
  softwareVersion: "12.8.4",
  warrantyStatus: "active",
};

const scenarioIds = new Set<SparkScenario>(["everyday", "duplicate_order", "faulty_charger", "delayed_replacement", "refund_pending"]);

export function isSparkScenario(value: unknown): value is SparkScenario {
  return typeof value === "string" && scenarioIds.has(value as SparkScenario);
}

export function resolveAccount(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const existing = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("spark_demo_id="))?.split("=")[1];
  return { accountId: existing || crypto.randomUUID(), setCookie: !existing };
}

export function attachAccountCookie(response: Response, accountId: string, shouldSet: boolean) {
  if (shouldSet) response.headers.append("Set-Cookie", `spark_demo_id=${accountId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  return response;
}

async function seedOrders(accountId: string, scenario: SparkScenario) {
  const now = Date.now();
  const orders = scenario === "duplicate_order"
    ? [
        { id: crypto.randomUUID(), orderNumber: "ORD-2212", accountId, productId: "all-weather-mats", item: "All-Weather Interior Mats", priceCents: 22500, status: "processing", deliveredDaysAgo: null, returnEligible: false, createdAt: now - 2 * 60000, updatedAt: now },
        { id: crypto.randomUUID(), orderNumber: "ORD-2211", accountId, productId: "all-weather-mats", item: "All-Weather Interior Mats", priceCents: 22500, status: "processing", deliveredDaysAgo: null, returnEligible: false, createdAt: now - 5 * 60000, updatedAt: now },
        { id: crypto.randomUUID(), orderNumber: "ORD-1842", accountId, productId: "home-connector", item: "Spark Home Connector", priceCents: 47500, status: "delivered", deliveredDaysAgo: 10, returnEligible: true, createdAt: now - 17 * 86400000, updatedAt: now },
      ]
    : scenario === "delayed_replacement"
    ? [
        { id: crypto.randomUUID(), orderNumber: "ORD-1904", accountId, productId: "home-connector", item: "Spark Home Connector replacement", priceCents: 0, status: "delayed", deliveredDaysAgo: null, returnEligible: false, createdAt: now - 6 * 86400000, updatedAt: now },
        { id: crypto.randomUUID(), orderNumber: "ORD-1842", accountId, productId: "home-connector", item: "Spark Home Connector", priceCents: 47500, status: "returned", deliveredDaysAgo: 24, returnEligible: false, createdAt: now - 31 * 86400000, updatedAt: now },
      ]
    : scenario === "refund_pending"
      ? [
          { id: crypto.randomUUID(), orderNumber: "ORD-1842", accountId, productId: "home-connector", item: "Spark Home Connector", priceCents: 47500, status: "refund_pending", deliveredDaysAgo: 18, returnEligible: false, createdAt: now - 25 * 86400000, updatedAt: now },
          { id: crypto.randomUUID(), orderNumber: "ORD-1759", accountId, productId: "all-weather-mats", item: "All-Weather Interior Mats", priceCents: 22500, status: "delivered", deliveredDaysAgo: 42, returnEligible: false, createdAt: now - 50 * 86400000, updatedAt: now },
        ]
      : [
          { id: crypto.randomUUID(), orderNumber: "ORD-1842", accountId, productId: "home-connector", item: "Spark Home Connector", priceCents: 47500, status: "delivered", deliveredDaysAgo: 10, returnEligible: true, createdAt: now - 17 * 86400000, updatedAt: now },
          { id: crypto.randomUUID(), orderNumber: "ORD-1759", accountId, productId: "all-weather-mats", item: "All-Weather Interior Mats", priceCents: 22500, status: "delivered", deliveredDaysAgo: 42, returnEligible: false, createdAt: now - 50 * 86400000, updatedAt: now },
        ];
  const db = getDb();
  for (const order of orders) await db.insert(demoOrders).values(order);
}

export async function resetSparkAccount(accountId: string, scenario: SparkScenario) {
  const db = getDb();
  const now = Date.now();
  await db.delete(chargingSessions).where(eq(chargingSessions.accountId, accountId));
  await db.delete(demoOrders).where(eq(demoOrders.accountId, accountId));
  const existing = await db.select().from(demoAccounts).where(eq(demoAccounts.id, accountId)).limit(1);
  const account = {
    creditsCents: scenario === "refund_pending" ? 37500 : scenario === "duplicate_order" ? 40000 : 85000,
    scenario,
    chargerStatus: scenario === "faulty_charger" ? "intermittent_disconnect" : "ready",
    updatedAt: now,
  };
  if (existing[0]) await db.update(demoAccounts).set(account).where(eq(demoAccounts.id, accountId));
  else await db.insert(demoAccounts).values({ id: accountId, ...account, createdAt: now });
  await seedOrders(accountId, scenario);
  return getSparkAccount(accountId);
}

export async function ensureSparkAccount(accountId: string) {
  const db = getDb();
  const existing = await db.select().from(demoAccounts).where(eq(demoAccounts.id, accountId)).limit(1);
  if (!existing[0]) return resetSparkAccount(accountId, "everyday");
  const existingOrders = await db.select({ id: demoOrders.id }).from(demoOrders).where(eq(demoOrders.accountId, accountId)).limit(1);
  if (!existingOrders[0]) await seedOrders(accountId, existing[0].scenario as SparkScenario);
  return getSparkAccount(accountId);
}

export async function getSparkAccount(accountId: string): Promise<SparkAccountSnapshot> {
  const db = getDb();
  const account = (await db.select().from(demoAccounts).where(eq(demoAccounts.id, accountId)).limit(1))[0];
  if (!account) return resetSparkAccount(accountId, "everyday");
  const orders = await db.select().from(demoOrders).where(eq(demoOrders.accountId, accountId)).orderBy(desc(demoOrders.createdAt));
  const latestCharging = (await db.select().from(chargingSessions).where(eq(chargingSessions.accountId, accountId)).orderBy(desc(chargingSessions.startedAt)).limit(1))[0] ?? null;
  return {
    id: account.id,
    creditsCents: account.creditsCents,
    scenario: account.scenario as SparkScenario,
    chargerStatus: account.chargerStatus,
    vehicle,
    latestCharging,
    orders: orders.map((order) => ({
      id: order.orderNumber,
      productId: order.productId,
      item: order.item,
      priceCents: order.priceCents,
      status: order.status,
      deliveredDaysAgo: order.deliveredDaysAgo,
      returnEligible: Boolean(order.returnEligible),
      createdAt: order.createdAt,
    })),
  };
}

export async function startSparkCharging(accountId: string) {
  const account = await ensureSparkAccount(accountId);
  const interrupted = account.chargerStatus === "intermittent_disconnect";
  const now = Date.now();
  const session = {
    id: `CHG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    accountId,
    status: interrupted ? "interrupted" : "charging",
    startedAt: now,
    endedAt: interrupted ? now + 6 * 60000 : null,
    energyWh: interrupted ? 620 : 0,
  };
  await getDb().insert(chargingSessions).values(session);
  return { account: await getSparkAccount(accountId), result: session };
}

export async function purchaseSparkProduct(accountId: string, productId: string) {
  const product = sparkProducts.find((item) => item.id === productId);
  if (!product) throw new Error("Product not found.");
  const account = await ensureSparkAccount(accountId);
  if (account.creditsCents < product.priceCents) throw new Error("Not enough Spark Credits for this purchase.");
  const now = Date.now();
  await getDb().update(demoAccounts).set({ creditsCents: account.creditsCents - product.priceCents, updatedAt: now }).where(eq(demoAccounts.id, accountId));
  const order = {
    id: crypto.randomUUID(),
    orderNumber: `ORD-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    accountId,
    productId: product.id,
    item: product.name,
    priceCents: product.priceCents,
    status: "processing",
    deliveredDaysAgo: null,
    returnEligible: false,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(demoOrders).values(order);
  return { account: await getSparkAccount(accountId), result: order };
}

export async function createSparkReturn(
  accountId: string,
  sessionId: string,
  orderId: string,
  reason: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const db = getDb();
  const order = (await db.select().from(demoOrders).where(and(eq(demoOrders.accountId, accountId), eq(demoOrders.orderNumber, orderId))).limit(1))[0];
  signal?.throwIfAborted();
  if (!order) return { error: "order_not_found" };
  if (!order.returnEligible) return { error: "order_not_eligible" };
  const existing = await db.select().from(returnRequests).where(eq(returnRequests.sessionId, sessionId)).limit(1);
  signal?.throwIfAborted();
  if (existing[0]) return existing[0];
  const request = {
    id: `RET-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    sessionId,
    orderId,
    reason,
    status: "pending",
    createdAt: Date.now(),
  };
  signal?.throwIfAborted();
  await db.insert(returnRequests).values(request);
  signal?.throwIfAborted();
  await db.update(demoOrders).set({ status: "return_pending", returnEligible: false, updatedAt: Date.now() }).where(eq(demoOrders.id, order.id));
  signal?.throwIfAborted();
  return request;
}

export async function cancelPendingSparkOrder(
  accountId: string,
  orderId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const db = getDb();
  const order = (await db.select().from(demoOrders).where(and(eq(demoOrders.accountId, accountId), eq(demoOrders.orderNumber, orderId))).limit(1))[0];
  signal?.throwIfAborted();
  if (!order) return { error: "order_not_found" };
  if (order.status === "canceled") {
    return {
      cancellationId: `CAN-${order.orderNumber}`,
      orderId: order.orderNumber,
      item: order.item,
      status: "canceled",
      creditsReturnedCents: 0,
      alreadyCanceled: true,
    };
  }
  if (order.status !== "processing") {
    return { error: "order_not_cancellable", orderId: order.orderNumber, status: order.status };
  }

  const now = Date.now();
  signal?.throwIfAborted();
  await db.batch([
    db.update(demoOrders).set({ status: "canceled", updatedAt: now }).where(and(eq(demoOrders.id, order.id), eq(demoOrders.status, "processing"))),
    db.update(demoAccounts).set({ creditsCents: sql`${demoAccounts.creditsCents} + ${order.priceCents}`, updatedAt: now }).where(eq(demoAccounts.id, accountId)),
  ]);
  signal?.throwIfAborted();
  return {
    cancellationId: `CAN-${order.orderNumber}`,
    orderId: order.orderNumber,
    item: order.item,
    status: "canceled",
    creditsReturnedCents: order.priceCents,
    alreadyCanceled: false,
  };
}
