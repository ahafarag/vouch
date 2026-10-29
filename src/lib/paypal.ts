// Thin PayPal REST client for the escrow flow: Orders v2 (fund), Payouts (release), Refunds.
// The AI agents get these operations as tools; see lib/agents/settlement.ts.

const BASE =
  process.env.PAYPAL_ENVIRONMENT === "PRODUCTION" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

let cached: { token: string; expires: number } | null = null;

export function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      // Idempotency: retries of the same money movement never execute twice.
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal ${method} ${path} failed: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const money = (n: number) => n.toFixed(2);

export async function createEscrowOrder(opts: {
  milestoneId: string;
  projectTitle: string;
  milestoneTitle: string;
  amount: number;
  currency: string;
}) {
  return call<{ id: string; status: string }>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.milestoneId,
          custom_id: opts.milestoneId,
          description: `Escrow: ${opts.projectTitle} / ${opts.milestoneTitle}`.slice(0, 127),
          soft_descriptor: "VOUCH ESCROW",
          amount: { currency_code: opts.currency, value: money(opts.amount) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Vouch Escrow",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
          },
        },
      },
    },
    `order-${opts.milestoneId}-${Date.now()}`,
  );
}

type CaptureResponse = {
  id: string;
  status: string;
  purchase_units: { payments: { captures: { id: string; status: string; amount: { value: string } }[] } }[];
  payer?: { email_address?: string; name?: { given_name?: string } };
};

export async function captureOrder(orderId: string) {
  const r = await call<CaptureResponse>("POST", `/v2/checkout/orders/${orderId}/capture`, {}, `capture-${orderId}`);
  const capture = r.purchase_units[0]?.payments.captures[0];
  return { status: r.status, captureId: capture?.id, captureStatus: capture?.status, payer: r.payer };
}

export async function getOrder(orderId: string) {
  return call<Record<string, unknown>>("GET", `/v2/checkout/orders/${orderId}`);
}

export async function payoutToFreelancer(opts: {
  receiverEmail: string;
  amount: number;
  currency: string;
  note: string;
  idempotencyKey: string;
}) {
  const r = await call<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: {
        sender_batch_id: opts.idempotencyKey,
        email_subject: "You've been paid via Vouch escrow",
        email_message: opts.note.slice(0, 1000),
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: opts.receiverEmail,
          amount: { value: money(opts.amount), currency: opts.currency },
          note: opts.note.slice(0, 4000),
          sender_item_id: opts.idempotencyKey,
        },
      ],
    },
    opts.idempotencyKey,
  );
  return { batchId: r.batch_header.payout_batch_id, status: r.batch_header.batch_status };
}

export async function refundCapture(opts: {
  captureId: string;
  amount: number;
  currency: string;
  note: string;
  idempotencyKey: string;
}) {
  const r = await call<{ id: string; status: string }>(
    "POST",
    `/v2/payments/captures/${opts.captureId}/refund`,
    { amount: { value: money(opts.amount), currency_code: opts.currency }, note_to_payer: opts.note.slice(0, 255) },
    opts.idempotencyKey,
  );
  return { refundId: r.id, status: r.status };
}

export async function getPayoutBatch(batchId: string) {
  const r = await call<{
    batch_header: { batch_status: string };
    items?: { payout_item_id: string; transaction_status: string }[];
  }>("GET", `/v1/payments/payouts/${batchId}`);
  const item = r.items?.[0];
  return { batchStatus: r.batch_header.batch_status, itemId: item?.payout_item_id ?? null, itemStatus: item?.transaction_status ?? null };
}

export async function getRefund(refundId: string) {
  const r = await call<{ id: string; status: string }>("GET", `/v2/payments/refunds/${refundId}`);
  return { refundId: r.id, status: r.status };
}

// PayPal signs every webhook delivery; ask PayPal to check the signature against our webhook id
// rather than trusting the request body.
export async function verifyWebhookSignature(headers: Headers, rawBody: string) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not set");
  const r = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: JSON.parse(rawBody),
  });
  return r.verification_status === "SUCCESS";
}
