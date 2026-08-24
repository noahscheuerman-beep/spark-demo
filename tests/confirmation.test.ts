import assert from "node:assert/strict";
import test from "node:test";
import { hasExplicitActionConfirmation } from "../lib/spark/confirmation";
import type { ChatMessage } from "../lib/spark/types";

function conversation(latestCustomerMessage: string): ChatMessage[] {
  return [
    { role: "assistant", content: "Would you like me to proceed?" },
    { role: "user", content: latestCustomerMessage },
  ];
}

test("a return request is not treated as confirmation", () => {
  assert.equal(
    hasExplicitActionConfirmation(conversation("It is ORD-1842. I want to return it."), "create_return_request"),
    false,
  );
});

test("an explicit return confirmation is accepted", () => {
  assert.equal(
    hasExplicitActionConfirmation(conversation("Yes, create the pending return request."), "create_return_request"),
    true,
  );
});

test("an explicit escalation request is accepted", () => {
  assert.equal(
    hasExplicitActionConfirmation(conversation("Yes, please open a case with a charging specialist."), "escalate_to_human"),
    true,
  );
});

test("an initial cancellation request is not treated as confirmation", () => {
  assert.equal(
    hasExplicitActionConfirmation(conversation("I think I ordered twice. Can you cancel one?"), "cancel_pending_order"),
    false,
  );
});

test("an explicit cancellation confirmation is accepted", () => {
  assert.equal(
    hasExplicitActionConfirmation(conversation("Yes, cancel order ORD-2212."), "cancel_pending_order"),
    true,
  );
});

test("a troubleshooting update is not escalation confirmation", () => {
  assert.equal(
    hasExplicitActionConfirmation(conversation("The red light came back after the reset."), "escalate_to_human"),
    false,
  );
});
