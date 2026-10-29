// Keeps each payout/refund's PayPal status current. PayPal settles payouts asynchronously, so a
// release starts PENDING. Two paths update it: signed webhooks (app/api/paypal/webhook) when PayPal
// can reach us, and polling PayPal while a page shows pending money (works locally too).
import * as db from "./db";
import * as paypal from "./paypal";
import { isSettled } from "./status";
import { money } from "@/components/ui";

const POLL_EVERY_MS = 5_000;

/** Applies a status from PayPal and logs the change once; returns true if it changed. */
export function applyStatus(paypalId: string, status: string, itemId: string | null, source: "webhook" | "poll") {
  const t = db.getTransfer(paypalId);
  if (!t || t.status === status) {
    if (t) db.updateTransfer(paypalId, { item_id: itemId });
    return false;
  }
  db.updateTransfer(paypalId, { status, item_id: itemId });
  const p = db.getProject(t.project_id);
  const ok = isSettled(status);
  const what = t.kind === "payout" ? `payout to ${p?.freelancer_name}` : `refund to ${p?.client_name}`;
  db.logEvent({
    project_id: t.project_id,
    milestone_id: t.milestone_id,
    type: ok ? `${t.kind}_confirmed` : `${t.kind}_${status.toLowerCase()}`,
    actor: "paypal",
    message: `PayPal ${ok ? "confirmed" : "reports"} the ${money(t.amount, p?.currency)} ${what}: ${status}${source === "webhook" ? " (signed webhook)" : ""}`,
    amount: t.amount,
    paypal_ref: itemId ?? paypalId,
  });
  return true;
}

/** Polls PayPal for transfers that are still pending; throttled per transfer. */
export async function syncPending(projectId?: string) {
  const due = db
    .getTransfers({ projectId, pendingOnly: true })
    .filter((t) => Date.now() - new Date(t.checked_at).getTime() >= POLL_EVERY_MS);
  let changed = false;
  await Promise.all(
    due.map(async (t) => {
      try {
        if (t.kind === "payout") {
          const r = await paypal.getPayoutBatch(t.paypal_id);
          changed = applyStatus(t.paypal_id, r.itemStatus ?? r.batchStatus, r.itemId, "poll") || changed;
        } else {
          const r = await paypal.getRefund(t.paypal_id);
          changed = applyStatus(t.paypal_id, r.status, null, "poll") || changed;
        }
      } catch (e) {
        // A failed status check must never break the page; try again on the next poll.
        console.error(`PayPal status check failed for ${t.paypal_id}:`, e);
        db.updateTransfer(t.paypal_id, {});
      }
    }),
  );
  return changed;
}
