import type { ChatMessage } from "./types";

const affirmativeConfirmation = /\b(?:yes|yep|yeah|confirm(?:ed)?|go ahead|proceed|do it)\b/i;
const returnConfirmation = /\b(?:please\s+)?(?:create|submit|start|process)\b[^.!?]{0,60}\breturn(?: request)?\b/i;
const cancellationConfirmation = /\b(?:confirm|approve|authorize)(?:ed|ing)?\b[^.!?]{0,60}\b(?:cancel|cancellation)\b|\b(?:cancel|cancellation)\b[^.!?]{0,60}\b(?:confirm|approve|authorize)(?:ed|ing)?\b/i;
const escalationConfirmation = /\b(?:please\s+)?(?:open|create)\b[^.!?]{0,60}\bcase\b|\b(?:please\s+)?(?:connect|escalate)\b[^.!?]{0,60}\b(?:me|specialist|support|human)\b/i;

export function hasExplicitActionConfirmation(messages: ChatMessage[], toolName: string) {
  const latestCustomerMessage = messages.findLast((message) => message.role === "user")?.content.trim() ?? "";
  if (!latestCustomerMessage) return false;
  if (affirmativeConfirmation.test(latestCustomerMessage)) return true;
  if (toolName === "create_return_request") return returnConfirmation.test(latestCustomerMessage);
  if (toolName === "cancel_pending_order") return cancellationConfirmation.test(latestCustomerMessage);
  if (toolName === "escalate_to_human") return escalationConfirmation.test(latestCustomerMessage);
  return true;
}
