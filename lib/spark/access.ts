export const SPARK_ACCESS_COOKIE = "spark_internal_access";

const cookiePurpose = "spark-internal-demo-access-v1";

export function configuredSparkAccessCode() {
  return process.env.SPARK_ACCESS_CODE?.trim() ?? "";
}

export function secretsMatch(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function sparkAccessCookieValue(accessCode: string) {
  const value = new TextEncoder().encode(`${cookiePurpose}:${accessCode}`);
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeReturnPath(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/access")) {
    return "/";
  }
  return value;
}
