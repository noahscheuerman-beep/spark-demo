import { ensureDb } from "../../../db";
import {
  attachAccountCookie,
  ensureSparkAccount,
  isSparkScenario,
  purchaseSparkProduct,
  resetSparkAccount,
  resolveAccount,
  startSparkCharging,
} from "../../../lib/spark/account";

type AccountAction = {
  action?: "start_charging" | "purchase" | "set_scenario" | "reset";
  productId?: string;
  scenario?: string;
};

export async function GET(request: Request) {
  try {
    await ensureDb();
    const { accountId, setCookie } = resolveAccount(request);
    const account = await ensureSparkAccount(accountId);
    return attachAccountCookie(Response.json({ account }), accountId, setCookie);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the Spark account." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    const payload = (await request.json()) as AccountAction;
    const { accountId, setCookie } = resolveAccount(request);
    let response: unknown;

    if (payload.action === "start_charging") response = await startSparkCharging(accountId);
    else if (payload.action === "purchase") response = await purchaseSparkProduct(accountId, payload.productId ?? "");
    else if (payload.action === "set_scenario" && isSparkScenario(payload.scenario)) response = { account: await resetSparkAccount(accountId, payload.scenario) };
    else if (payload.action === "reset") {
      const account = await ensureSparkAccount(accountId);
      response = { account: await resetSparkAccount(accountId, account.scenario) };
    } else return Response.json({ error: "Unknown account action." }, { status: 400 });

    return attachAccountCookie(Response.json(response), accountId, setCookie);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the Spark account." }, { status: 500 });
  }
}
