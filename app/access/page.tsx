import type { Metadata } from "next";
import { safeReturnPath } from "../../lib/spark/access";

export const metadata: Metadata = {
  title: "Spark | Internal access",
};

type AccessPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function AccessPage({ searchParams }: AccessPageProps) {
  const params = await searchParams;
  const errorMessage = params.error === "invalid"
    ? "That access code did not match. Try again."
    : params.error === "configuration"
      ? "Spark access has not been configured for this deployment."
      : null;

  return (
    <main className="access-shell">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-brand"><span className="brand-mark">S</span><span>Spark</span></div>
        <p className="access-eyebrow">Braintrust SE demo</p>
        <h1 id="access-title">Internal access</h1>
        <p>Enter the shared Spark access code to open the demo.</p>
        {errorMessage && <div className="access-error" role="alert">{errorMessage}</div>}
        <form action="/api/access" method="post">
          <input type="hidden" name="next" value={safeReturnPath(params.next)} />
          <label htmlFor="access-code">Access code</label>
          <input id="access-code" name="code" type="password" autoComplete="current-password" required />
          <button type="submit">Open Spark</button>
        </form>
      </section>
    </main>
  );
}
