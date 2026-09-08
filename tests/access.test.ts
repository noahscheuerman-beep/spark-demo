import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnPath, secretsMatch, sparkAccessCookieValue } from "../lib/spark/access";

test("access cookies are deterministic without containing the shared code", async () => {
  const first = await sparkAccessCookieValue("team-secret");
  const second = await sparkAccessCookieValue("team-secret");
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.doesNotMatch(first, /team-secret/);
  assert.notEqual(first, await sparkAccessCookieValue("different-secret"));
});

test("shared access values use a full constant-time comparison", () => {
  assert.equal(secretsMatch("spark-team", "spark-team"), true);
  assert.equal(secretsMatch("spark-team", "spark-other"), false);
  assert.equal(secretsMatch("", ""), false);
});

test("return paths cannot leave the Spark deployment or loop through access", () => {
  assert.equal(safeReturnPath("/orders?view=recent"), "/orders?view=recent");
  assert.equal(safeReturnPath("https://example.com"), "/");
  assert.equal(safeReturnPath("//example.com"), "/");
  assert.equal(safeReturnPath("/access?next=/access"), "/");
});
