import { revalidatePath } from "next/cache";
import * as db from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/paypal";
import { applyStatus } from "@/lib/transfers";

type WebhookEvent = {
  id: string;
  event_type: string;
  resource: {
    id?: string;
    status?: string;
    payout_batch_id?: string;
    payout_item_id?: string;
    transaction_status?: string;
  };
};

// PayPal calls this when a payout item or refund changes state. Only signature-verified events
// are applied, and each event id is handled once (PayPal retries deliveries).
export async function POST(request: Request) {
  if (!process.env.PAYPAL_WEBHOOK_ID) return Response.json({ error: "Webhook not configured" }, { status: 503 });
  const raw = await request.text();
  let verified = false;
  try {
    verified = await verifyWebhookSignature(request.headers, raw);
  } catch (e) {
    console.error("PayPal webhook verification error:", e);
  }
  if (!verified) return Response.json({ error: "Invalid signature" }, { status: 400 });

  const event = JSON.parse(raw) as WebhookEvent;
  if (!db.markWebhookEvent(event.id, event.event_type)) return Response.json({ ok: true, duplicate: true });

  const r = event.resource;
  let paypalId: string | undefined;
  if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.") && r.payout_batch_id && r.transaction_status) {
    paypalId = r.payout_batch_id;
    applyStatus(paypalId, r.transaction_status, r.payout_item_id ?? null, "webhook");
  } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" && r.id && r.status) {
    paypalId = r.id;
    applyStatus(paypalId, r.status, null, "webhook");
  }

  const t = paypalId ? db.getTransfer(paypalId) : undefined;
  if (t) {
    revalidatePath(`/p/${t.project_id}`);
    revalidatePath("/ledger");
  }
  return Response.json({ ok: true, applied: Boolean(t) });
}
