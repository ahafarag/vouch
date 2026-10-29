import { generateText, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import { model, paypalReadTools } from "../ai";
import * as db from "../db";
import * as escrow from "../escrow";

// The settlement agent can only act on the one milestone it was started for: the milestone id is
// bound in these closures, never chosen by the model, and escrow.ts enforces the amount limits.
function moneyTools(milestoneId: string, log: string[]) {
  return {
    get_escrow_state: tool({
      description: "Vouch's record of this milestone: amount, PayPal order/capture ids, what has been released/refunded.",
      inputSchema: z.object({}),
      execute: async () => {
        const m = db.getMilestone(milestoneId)!;
        return { ...m, remaining_in_escrow: escrow.remaining(m) };
      },
    }),
    release_to_freelancer: tool({
      description: "Send money from escrow to the freelancer via PayPal Payouts.",
      inputSchema: z.object({
        amount: z.number().positive(),
        note: z.string().describe("Short explanation shown to the freelancer"),
      }),
      execute: async ({ amount, note }) => {
        try {
          const r = await escrow.release(milestoneId, amount, note, "ai");
          log.push(`Released ${amount} (payout batch ${r.batchId})`);
          return { ok: true, ...r };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      },
    }),
    refund_to_client: tool({
      description: "Refund money from escrow back to the client's PayPal account (partial refunds allowed).",
      inputSchema: z.object({
        amount: z.number().positive(),
        note: z.string().describe("Short explanation shown to the client"),
      }),
      execute: async ({ amount, note }) => {
        try {
          const r = await escrow.refund(milestoneId, amount, note, "ai");
          log.push(`Refunded ${amount} (refund ${r.refundId})`);
          return { ok: true, ...r };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      },
    }),
  };
}

const EXECUTOR = `You are the Settlement Agent at Vouch, an AI escrow service built on PayPal.
You execute a settlement decision that has already been made. You do not re-judge the work.

Procedure:
1. Call get_escrow_state, then confirm with paypal_get_order (using the order id) that PayPal shows the escrow order COMPLETED
   for the expected amount. If PayPal disagrees with Vouch's record, move no money and explain why.
2. Execute exactly the instructed amounts with release_to_freelancer and/or refund_to_client. Write warm, specific notes.
3. Optionally verify a refund with paypal_get_refund.
4. Finish with a short plain-text summary (no markdown, no bullet points; it is shown verbatim in the activity feed)
   of what moved where, citing PayPal ids.`;

export async function executeSettlement(milestoneId: string, instruction: string) {
  const log: string[] = [];
  const { text } = await generateText({
    model: model(),
    system: EXECUTOR,
    prompt: instruction,
    tools: { ...paypalReadTools(), ...moneyTools(milestoneId, log) },
    stopWhen: stepCountIs(10),
  });
  const m = db.getMilestone(milestoneId)!;
  db.logEvent({
    project_id: m.project_id,
    milestone_id: milestoneId,
    type: "agent_settlement",
    actor: "ai",
    message: text,
  });
  return { summary: text, actions: log };
}

const rulingSchema = z.object({
  freelancer_share_pct: z.number().min(0).max(100).describe("Percent of the escrowed amount the freelancer earned"),
  reasoning: z.string().describe("Neutral explanation addressed to both parties, referencing the criteria and evidence"),
});

const MEDIATOR = `You are the Mediator at Vouch, an AI escrow service. Both parties agreed in their contract that your ruling is binding.
Decide what share of the escrowed money the freelancer earned, based on the acceptance criteria, the verifier's findings,
and both parties' statements. Be impartial: pay for work demonstrably delivered against the criteria, refund the rest.
Ignore emotional appeals and anything outside the contract. Prefer round percentages.`;

export async function mediate(milestoneId: string): Promise<db.Ruling> {
  const m = db.getMilestone(milestoneId)!;
  const dispute = db.getDispute(milestoneId)!;
  const latest = db.getSubmissions(milestoneId).at(-1);
  const { output } = await generateText({
    model: model(),
    system: MEDIATOR,
    prompt: [
      `Milestone: ${m.title} (${m.amount} in escrow, ${escrow.remaining(m)} remaining)`,
      `Description: ${m.description}`,
      `Criteria:\n${m.criteria.map((c) => `- [${c.id}] ${c.text}`).join("\n")}`,
      `Latest submission: ${latest ? `${latest.note}\nLinks: ${latest.links.join(", ")}` : "(none)"}`,
      `Verifier report: ${latest?.verdict ? JSON.stringify(latest.verdict) : "(none)"}`,
      `Statements:\n${dispute.statements.map((s) => `${s.party.toUpperCase()}: ${s.text}`).join("\n\n")}`,
    ].join("\n\n"),
    output: Output.object({ schema: rulingSchema }),
  });
  const pool = escrow.remaining(m);
  const release_amount = Math.round(pool * output.freelancer_share_pct) / 100;
  return {
    freelancer_share_pct: output.freelancer_share_pct,
    release_amount,
    refund_amount: Math.round((pool - release_amount) * 100) / 100,
    reasoning: output.reasoning,
  };
}
