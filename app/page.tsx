"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { formatCredits, sparkProducts, sparkScenarios, type SparkScenario } from "../lib/spark/catalog";

const suggestedQuestions = [
  "My home charger keeps cutting out",
  "Check my replacement order",
  "I need to return an accessory",
];

const supportWelcome = "Welcome to Spark Support. I can help with your Spark One, charging setup, recent orders, or Spark Credits. What’s going on?";

type UiMessage = { role: "user" | "assistant"; content: string };
type ChargingState = "idle" | "starting" | "charging" | "interrupted";
type SparkOrder = {
  id: string;
  productId: string;
  item: string;
  priceCents: number;
  status: string;
  deliveredDaysAgo: number | null;
  returnEligible: boolean;
  createdAt: number;
};
type SparkAccount = {
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
  latestCharging: null | { status: string };
  orders: SparkOrder[];
};

const initialAccount: SparkAccount = {
  id: "",
  creditsCents: 85000,
  scenario: "everyday",
  chargerStatus: "ready",
  vehicle: {
    model: "Spark One",
    modelYear: 2026,
    trim: "Silverline",
    chargePercent: 78,
    estimatedRangeMiles: 241,
    softwareVersion: "12.8.4",
    warrantyStatus: "active",
  },
  latestCharging: null,
  orders: [],
};

function chargingStateFromAccount(account: SparkAccount): ChargingState {
  if (account.latestCharging?.status === "interrupted") return "interrupted";
  if (account.latestCharging?.status === "charging") return "charging";
  return "idle";
}

function orderStatus(order: SparkOrder) {
  if (order.status === "refund_pending") return "Refund pending";
  if (order.status === "return_pending") return "Return started";
  if (order.status === "delayed") return "Delayed";
  if (order.status === "processing") return "Processing";
  if (order.status === "returned") return "Returned";
  if (order.status === "canceled") return "Canceled";
  return order.deliveredDaysAgo === null ? "Order placed" : `Delivered ${order.deliveredDaysAgo} days ago`;
}

function orderSupportPrompt(order: SparkOrder) {
  if (order.status === "delayed") return `My replacement order ${order.id} is delayed. Can you check what is going on?`;
  if (order.status === "refund_pending") return `I returned order ${order.id}, but the ${formatCredits(order.priceCents)} refund is still missing from my Spark Credits.`;
  if (order.status === "return_pending") return `What is the status of my return for order ${order.id}?`;
  if (order.status === "canceled") return `Can you confirm the cancellation details for order ${order.id}?`;
  if (order.status === "processing") return `Can you check whether order ${order.id} can still be canceled?`;
  if (order.item.includes("Home Connector")) return "I need to return my Spark Home Connector because it keeps cutting out.";
  return `Can you check order ${order.id} for my ${order.item}?`;
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([
    { role: "assistant", content: supportWelcome },
  ]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<SparkAccount>(initialAccount);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountAction, setAccountAction] = useState<string | null>(null);
  const [chargingState, setChargingState] = useState<ChargingState>("idle");
  const [selectedScenario, setSelectedScenario] = useState<SparkScenario>("everyday");
  const [notice, setNotice] = useState<string | null>(null);
  const sessionId = useRef(crypto.randomUUID());
  const messageInput = useRef<HTMLInputElement>(null);
  const promptVersion = useRef<"baseline-v1" | "improved-v1">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("agent") === "improved"
      ? "improved-v1"
      : "baseline-v1",
  );

  useEffect(() => {
    let active = true;
    fetch("/api/account")
      .then(async (response) => {
        const result = await response.json() as { account?: SparkAccount; error?: string };
        if (!response.ok || !result.account) throw new Error(result.error || "Could not load your Spark account.");
        if (!active) return;
        setAccount(result.account);
        setSelectedScenario(result.account.scenario);
        setChargingState(chargingStateFromAccount(result.account));
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "Could not load your Spark account."))
      .finally(() => active && setAccountLoading(false));
    return () => { active = false; };
  }, []);

  async function refreshAccount() {
    const response = await fetch("/api/account");
    const result = await response.json() as { account?: SparkAccount; error?: string };
    if (!response.ok || !result.account) throw new Error(result.error || "Could not refresh your Spark account.");
    setAccount(result.account);
    setSelectedScenario(result.account.scenario);
    setChargingState(chargingStateFromAccount(result.account));
  }

  async function accountRequest(action: string, values: Record<string, unknown> = {}) {
    const response = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...values }),
    });
    const result = await response.json() as { account?: SparkAccount; result?: { status?: string }; error?: string };
    if (!response.ok || !result.account) throw new Error(result.error || "Spark could not complete that action.");
    setAccount(result.account);
    return result;
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = message.trim();
    if (!value || sending) return;
    setMessages((current) => [...current, { role: "user", content: value }]);
    setMessage("");
    setSending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message: value, source: "interactive", scenarioId: account.scenario, promptVersion: promptVersion.current }),
      });
      const result = await response.json() as { content?: string; error?: string };
      if (!response.ok || !result.content) throw new Error(result.error || "Spark Support is unavailable.");
      setMessages((current) => [...current, { role: "assistant", content: result.content! }]);
      await refreshAccount();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Spark Support is unavailable.");
    } finally {
      setSending(false);
    }
  }

  function resetConversation() {
    sessionId.current = crypto.randomUUID();
    setMessages([{ role: "assistant", content: supportWelcome }]);
    setMessage("");
    setError(null);
  }

  function prepareSupportMessage(value: string) {
    setMessage(value);
    requestAnimationFrame(() => {
      document.getElementById("support")?.scrollIntoView({ behavior: "smooth", block: "center" });
      messageInput.current?.focus();
    });
  }

  function scrollTo(section: string) {
    document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function startCharging() {
    setChargingState("starting");
    setAccountAction("charging");
    setError(null);
    try {
      const [result] = await Promise.all([
        accountRequest("start_charging"),
        new Promise((resolve) => window.setTimeout(resolve, 650)),
      ]);
      const status = result.result?.status === "interrupted" ? "interrupted" : "charging";
      setChargingState(status);
      setNotice(status === "charging" ? "Charging started successfully." : "Charging stopped after an unexpected disconnect.");
    } catch (caught) {
      setChargingState("idle");
      setError(caught instanceof Error ? caught.message : "Could not start charging.");
    } finally {
      setAccountAction(null);
    }
  }

  async function purchase(productId: string) {
    setAccountAction(`purchase-${productId}`);
    setError(null);
    try {
      const product = sparkProducts.find((item) => item.id === productId);
      await accountRequest("purchase", { productId });
      setNotice(`${product?.name ?? "Item"} added to your orders.`);
      window.setTimeout(() => scrollTo("orders"), 250);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete the purchase.");
    } finally {
      setAccountAction(null);
    }
  }

  async function loadScenario(resetOnly = false) {
    setAccountAction("scenario");
    setError(null);
    try {
      const result = resetOnly
        ? await accountRequest("reset")
        : await accountRequest("set_scenario", { scenario: selectedScenario });
      setSelectedScenario(result.account!.scenario);
      setChargingState("idle");
      resetConversation();
      const label = sparkScenarios.find((item) => item.id === result.account!.scenario)?.label;
      setNotice(`${label} is ready.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the scenario.");
    } finally {
      setAccountAction(null);
    }
  }

  const currentScenario = sparkScenarios.find((item) => item.id === account.scenario) ?? sparkScenarios[0];
  const systemLabel = chargingState === "interrupted" ? "Charging needs attention" : chargingState === "charging" ? "Charging at home" : "All systems normal";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Spark home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>Spark</span>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a className="active" href="#vehicle">Vehicle</a>
          <a href="#charging">Charging</a>
          <a href="#shop">Shop</a>
          <a href="#orders">Orders</a>
          <a href="#support">Support</a>
        </nav>
        <span className="topbar-spacer" aria-hidden="true" />
      </header>

      <section className="demo-toolbar" aria-label="Internal demo controls">
        <div className="demo-label"><span>Internal</span><strong>Demo scenario</strong></div>
        <label className="sr-only" htmlFor="scenario-select">Demo scenario</label>
        <select id="scenario-select" value={selectedScenario} onChange={(event) => setSelectedScenario(event.target.value as SparkScenario)} disabled={accountAction === "scenario"}>
          {sparkScenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}
        </select>
        <button type="button" onClick={() => loadScenario(false)} disabled={accountAction === "scenario" || selectedScenario === account.scenario}>Load scenario</button>
        <button className="quiet" type="button" onClick={() => loadScenario(true)} disabled={accountAction === "scenario"}>Reset data</button>
        <p>{currentScenario.description}</p>
      </section>

      <section className="dashboard" id="vehicle">
        {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
        {error && <div className="page-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>Dismiss</button></div>}

        <div className="eyebrow-row">
          <div>
            <p className="eyebrow">Vehicle overview</p>
            <h1>Your Spark One</h1>
          </div>
          <div className="account-overview">
            <div><span>Spark Credits</span><strong>{accountLoading ? "Loading" : formatCredits(account.creditsCents)}</strong></div>
            <span className={`status-pill${chargingState === "interrupted" ? " attention" : chargingState === "charging" ? " charging" : ""}`}><i /> {systemLabel}</span>
          </div>
        </div>

        <div className="content-grid">
          <section className="vehicle-panel" aria-label="Vehicle overview">
            <div className="vehicle-stage">
              <div className="vehicle-glow" />
              {/* Direct serving preserves the generated asset's transparent alpha channel. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="vehicle-image" src="/spark-one.png" alt="Silver Spark One electric crossover" fetchPriority="high" />
              <div className="vehicle-copy"><span>2026 Spark One</span><strong>Silverline</strong></div>
            </div>

            <div className="vehicle-stats">
              <div><span className="stat-icon">↯</span><p>Charge</p><strong>{account.vehicle.chargePercent}%</strong></div>
              <div><span className="stat-icon">◎</span><p>Estimated range</p><strong>{account.vehicle.estimatedRangeMiles} mi</strong></div>
              <div><span className="stat-icon">⌁</span><p>Software</p><strong>v{account.vehicle.softwareVersion}</strong></div>
            </div>

            <div className="quick-actions" id="charging" aria-label="Quick actions">
              <button type="button" onClick={startCharging} disabled={accountAction === "charging" || accountLoading}>
                <span>▰</span> {chargingState === "starting" ? "Connecting..." : chargingState === "charging" ? "Charging now" : chargingState === "interrupted" ? "Try charging again" : "Start charging"}
              </button>
              <button type="button" onClick={() => scrollTo("orders")}><span>◫</span> View orders</button>
            </div>

            {chargingState === "charging" && (
              <section className="charging-alert success" role="status" aria-label="Charging active">
                <div className="alert-icon">↯</div>
                <div><strong>Charging at 6.8 kW</strong><p>Your Spark One is charging normally. Estimated time to 90% is 1 hour 42 minutes.</p></div>
                <button type="button" onClick={() => prepareSupportMessage("Can you tell me about my current charging session?")}>Ask support</button>
              </section>
            )}

            {chargingState === "interrupted" && (
              <section className="charging-alert" role="status" aria-label="Charging interruption">
                <div className="alert-icon">!</div>
                <div><strong>Charging interrupted</strong><p>Your Home Connector stopped 6 minutes into the session. The vehicle is no longer charging.</p></div>
                <button type="button" onClick={() => prepareSupportMessage("My Spark Home Connector keeps cutting out and I want to return it.")}>Get help</button>
              </section>
            )}
          </section>

          <section className="support-card" id="support" aria-label="Spark support chat">
            <div className="support-header">
              <div><span className="assistant-mark">S</span><span className="online-dot" /></div>
              <div><h2>Spark Support</h2><p>Here when you need us</p></div>
              <button type="button" onClick={resetConversation} aria-label="Start a new conversation" title="Start a new conversation">↻</button>
            </div>

            <div className="conversation" aria-live="polite">
              <p className="time-label">Today, 2:41 PM</p>
              {messages.map((item, index) => item.role === "assistant" ? (
                <div className="assistant-row" key={`${item.role}-${index}`}><span className="small-mark">S</span><div className="bubble assistant-bubble">{item.content}</div></div>
              ) : (
                <div className="customer-row" key={`${item.role}-${index}`}><div className="bubble customer-bubble">{item.content}</div></div>
              ))}
              {sending && <div className="assistant-row thinking-row"><span className="small-mark">S</span><div className="bubble assistant-bubble thinking"><i /><i /><i /></div></div>}
              {messages.length === 1 && !sending && (
                <div className="suggestions">
                  <p>Suggested questions</p>
                  {suggestedQuestions.map((question) => <button key={question} type="button" onClick={() => setMessage(question)}>{question}<span>›</span></button>)}
                </div>
              )}
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <label className="sr-only" htmlFor="support-message">Message Spark Support</label>
              <input ref={messageInput} id="support-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask Spark Support..." autoComplete="off" />
              <button type="submit" disabled={!message.trim() || sending} aria-label="Send message">↑</button>
            </form>
            <p className="support-note">Spark Support can make mistakes. Check important information.</p>
          </section>
        </div>

        <section className="commerce-section" id="shop" aria-labelledby="shop-title">
          <div className="section-heading">
            <div><p className="eyebrow">Spark Shop</p><h2 id="shop-title">Made for your Spark One</h2></div>
            <div className="credit-balance"><span>Available credits</span><strong>{formatCredits(account.creditsCents)}</strong></div>
          </div>
          <div className="product-grid">
            {sparkProducts.map((product) => (
              <article className="product-card" key={product.id}>
                <div className={`product-art ${product.icon}`} aria-hidden="true"><span>{product.icon === "bolt" ? "↯" : product.icon === "grid" ? "▦" : "▭"}</span></div>
                <div className="product-details"><h3>{product.name}</h3><p>{product.description}</p></div>
                <div className="product-buy"><strong>{formatCredits(product.priceCents)}</strong><button type="button" onClick={() => purchase(product.id)} disabled={accountAction !== null || account.creditsCents < product.priceCents}>{accountAction === `purchase-${product.id}` ? "Purchasing..." : "Buy with credits"}</button></div>
              </article>
            ))}
          </div>
        </section>

        <section className="orders-section" id="orders" aria-labelledby="orders-title">
          <div className="section-heading">
            <div><p className="eyebrow">Account activity</p><h2 id="orders-title">Recent orders</h2></div>
            <span>{account.orders.length} orders</span>
          </div>
          <div className="order-list">
            {account.orders.map((order) => (
              <article className="order-row" key={order.id}>
                <div className="order-image" aria-hidden="true"><span>{order.item.includes("Connector") ? "↯" : order.item.includes("Mats") ? "▦" : "▭"}</span></div>
                <div className="order-copy">
                  <div><strong>{order.item}</strong><span>{formatCredits(order.priceCents)}</span></div>
                  <p>Order {order.id}</p>
                </div>
                <span className={`order-status ${order.status}`}>{orderStatus(order)}</span>
                {order.returnEligible && <span className="eligibility">Eligible for return · {30 - (order.deliveredDaysAgo ?? 30)} days remaining</span>}
                <button type="button" onClick={() => prepareSupportMessage(orderSupportPrompt(order))}>Get support</button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
