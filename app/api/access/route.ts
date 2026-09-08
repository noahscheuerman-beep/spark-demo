import { NextResponse } from "next/server";
import {
  configuredSparkAccessCode,
  safeReturnPath,
  secretsMatch,
  SPARK_ACCESS_COOKIE,
  sparkAccessCookieValue,
} from "../../../lib/spark/access";

export async function POST(request: Request) {
  const form = await request.formData();
  const returnPath = safeReturnPath(form.get("next"));
  const configuredCode = configuredSparkAccessCode();
  const providedCode = typeof form.get("code") === "string" ? String(form.get("code")).trim() : "";

  if (!configuredCode) {
    const target = new URL("/access", request.url);
    target.searchParams.set("error", "configuration");
    return NextResponse.redirect(target, { status: 303 });
  }

  if (!secretsMatch(providedCode, configuredCode)) {
    const target = new URL("/access", request.url);
    target.searchParams.set("error", "invalid");
    target.searchParams.set("next", returnPath);
    return NextResponse.redirect(target, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(returnPath, request.url), { status: 303 });
  response.cookies.set(SPARK_ACCESS_COOKIE, await sparkAccessCookieValue(configuredCode), {
    httpOnly: true,
    maxAge: 60 * 60 * 12,
    path: "/",
    sameSite: "lax",
    secure: Boolean(process.env.VERCEL),
  });
  return response;
}
