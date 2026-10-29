// Escrow state machine. Every money movement goes through here, whether a human clicked a
// button or the AI settlement agent called a tool, so the invariants hold for both:
//   released + refunded <= funded amount, and nothing moves before PayPal confirms the capture.
import * as db from "./db";
import * as paypal from "./paypal";

export function remaining(m: db.Milestone) {
  return Math.round((m.amount - m.released - m.refunded) * 100) / 100;
}

function context(milestoneId: string) {
  const m = db.requireMilestone(milestoneId);
  const p = db.getProject(m.project_id)!;
  return { m, p };
}

export async function startFunding(milestoneId: string) {
  const { m, p } = context(milestoneId);
  if (m.capture_id) throw new Error("Milestone already funded");
  const order = await paypal.createEscrowOrder({
    milestoneId,
    projectTitle: p.title,
    milestoneTitle: m.title,
    amount: m.amount,
    currency: p.currency,
  });
  db.updateMilestone(milestoneId, { order_id: order.id });
  return order.id;
}

export async function completeFunding(milestoneId: string, orderId: string) {
  const { m, p } = context(milestoneId);
  if (m.order_id !== orderId) throw new Error("Order does not belong to this milestone");
  const r = await paypal.captureOrder(orderId);
  if (r.status !== "COMPLETED" || !r.captureId) throw new Error(`Capture not completed (${r.status})`);
  db.updateMilestone(milestoneId, { capture_id: r.captureId, status: "funded" });
  db.logEvent({
    project_id: p.id,
    milestone_id: milestoneId,
    type: "escrow_funded",
    actor: "paypal",
    message: `${p.client_name} funded "${m.title}" — held in escrow`,
    amount: m.amount,
    paypal_ref: r.captureId,
  });
}

function settleStatus(milestoneId: string) {
  const m = db.getMilestone(milestoneId)!;
  if (remaining(m) > 0) return;
  const status = m.refunded === 0 ? "released" : m.released === 0 ? "refunded" : "split";
  db.updateMilestone(milestoneId, { status });
}

export async function release(milestoneId: string, amount: number, note: string, actor: db.Actor) {
  const { m, p } = context(milestoneId);
  if (!m.capture_id) throw new Error("Milestone is not funded");
  if (amount <= 0 || amount > remaining(m) + 0.001)
    throw new Error(`Release of ${amount} rejected: only ${remaining(m)} ${p.currency} left in escrow`);
  const released = Math.round((m.released + amount) * 100) / 100;
  const r = await paypal.payoutToFreelancer({
    receiverEmail: p.freelancer_email,
    amount,
    currency: p.currency,
    note,
    idempotencyKey: `rel-${milestoneId}-${Math.round(released * 100)}`,
  });
  db.updateMilestone(milestoneId, { released });
  db.logEvent({
    project_id: p.id,
    milestone_id: milestoneId,
    type: "payout_sent",
    actor,
    message: `Released to ${p.freelancer_name}: ${note}`,
    amount,
    paypal_ref: r.batchId,
  });
  settleStatus(milestoneId);
  return r;
}

export async function refund(milestoneId: string, amount: number, note: string, actor: db.Actor) {
  const { m, p } = context(milestoneId);
  if (!m.capture_id) throw new Error("Milestone is not funded");
  if (amount <= 0 || amount > remaining(m) + 0.001)
    throw new Error(`Refund of ${amount} rejected: only ${remaining(m)} ${p.currency} left in escrow`);
  const refunded = Math.round((m.refunded + amount) * 100) / 100;
  const r = await paypal.refundCapture({
    captureId: m.capture_id,
    amount,
    currency: p.currency,
    note,
    idempotencyKey: `ref-${milestoneId}-${Math.round(refunded * 100)}`,
  });
  db.updateMilestone(milestoneId, { refunded });
  db.logEvent({
    project_id: p.id,
    milestone_id: milestoneId,
    type: "refund_issued",
    actor,
    message: `Refunded to ${p.client_name}: ${note}`,
    amount,
    paypal_ref: r.refundId,
  });
  settleStatus(milestoneId);
  return r;
}
