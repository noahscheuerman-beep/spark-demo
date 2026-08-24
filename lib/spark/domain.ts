import { cancelPendingSparkOrder, createSparkReturn, ensureSparkAccount } from "./account";

export async function runTool(
  accountId: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const account = await ensureSparkAccount(accountId);
  signal.throwIfAborted();

  if (name === "get_vehicle_status") {
    return { ...account.vehicle, chargerStatus: account.chargerStatus, latestCharging: account.latestCharging };
  }

  if (name === "diagnose_home_charger") {
    if (account.chargerStatus !== "intermittent_disconnect") {
      return {
        connectorStatus: "ready",
        lastSession: account.latestCharging?.status ?? "none",
        findings: ["no active connector faults", "vehicle handshake available"],
      };
    }
    return {
      connectorStatus: "intermittent_disconnect",
      lastSeen: "during the latest charging attempt",
      likelyCauses: ["loose vehicle connection", "thermal protection event", "firmware handshake"],
      safeFirstSteps: ["reseat the vehicle connector", "check the wall unit status light", "avoid opening the wall unit"],
    };
  }

  if (name === "get_recent_orders") return account.orders;

  if (name === "get_pending_orders") {
    return account.orders
      .filter((order) => order.status === "processing")
      .map((order) => ({
        orderId: order.id,
        item: order.item,
        priceCents: order.priceCents,
        status: order.status,
        cancelEligible: true,
        createdAt: order.createdAt,
      }));
  }

  if (name === "check_return_eligibility") {
    const order = account.orders.find((item) => item.id === args.orderId);
    return order
      ? {
          orderId: order.id,
          item: order.item,
          status: order.status,
          eligible: order.returnEligible,
          daysRemaining: order.deliveredDaysAgo === null ? 0 : Math.max(0, 30 - order.deliveredDaysAgo),
        }
      : { error: "order_not_found" };
  }

  if (name === "create_return_request") {
    if (args.confirmed !== true) return { error: "explicit_confirmation_required" };
    signal.throwIfAborted();
    return createSparkReturn(
      accountId,
      sessionId,
      String(args.orderId ?? ""),
      String(args.reason ?? "Customer requested return"),
      signal,
    );
  }

  if (name === "cancel_pending_order") {
    if (args.confirmed !== true) return { error: "explicit_confirmation_required" };
    signal.throwIfAborted();
    return cancelPendingSparkOrder(accountId, String(args.orderId ?? ""), signal);
  }

  if (name === "escalate_to_human") {
    const reason = String(args.reason ?? "");
    const urgentFulfillmentIssue = /duplicate|cancel|before (?:it )?ships?|pre[- ]shipment/i.test(reason);
    return {
      caseId: `CASE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      status: "queued",
      priority: urgentFulfillmentIssue ? "urgent" : "standard",
      expectedResponse: urgentFulfillmentIssue ? "within 15 minutes" : "within 2 business hours",
    };
  }

  return { error: "unknown_tool", name };
}
