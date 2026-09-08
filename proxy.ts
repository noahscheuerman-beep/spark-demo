import { NextRequest, NextResponse } from "next/server";
import {
  configuredSparkAccessCode,
  secretsMatch,
  SPARK_ACCESS_COOKIE,
  sparkAccessCookieValue,
} from "./lib/spark/access";

function isInternalChatRequest(request: NextRequest) {
  const configuredToken = process.env.SPARK_INTERNAL_TOKEN?.trim() ?? "";
  const providedToken = request.headers.get("x-spark-internal-token")?.trim() ?? "";
  return request.nextUrl.pathname === "/api/chat" && secretsMatch(providedToken, configuredToken);
}

export async function proxy(request: NextRequest) {
  const accessCode = configuredSparkAccessCode();

  // Local clones stay easy to run. Hosted deployments fail closed until a team code is configured.
  if (!accessCode && !process.env.VERCEL) return NextResponse.next();
  if (request.nextUrl.pathname === "/access" || request.nextUrl.pathname === "/api/access") return NextResponse.next();
  if (isInternalChatRequest(request)) return NextResponse.next();

  const providedCookie = request.cookies.get(SPARK_ACCESS_COOKIE)?.value ?? "";
  const validCookie = accessCode
    ? secretsMatch(providedCookie, await sparkAccessCookieValue(accessCode))
    : false;
  if (validCookie) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Spark is available only to authorized Braintrust SEs.", code: "spark_access_required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const accessUrl = new URL("/access", request.url);
  accessUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (!accessCode) accessUrl.searchParams.set("error", "configuration");
  return NextResponse.redirect(accessUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.svg|spark-one.png).*)"],
};
