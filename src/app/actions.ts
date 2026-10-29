"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as db from "@/lib/db";
import * as escrow from "@/lib/escrow";
import { draftContract, type DraftContract } from "@/lib/agents/architect";
import { verifySubmission } from "@/lib/agents/verifier";
import { executeSettlement, mediate } from "@/lib/agents/settlement";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function refresh(milestoneId: string) {
  const m = db.getMilestone(milestoneId);
  if (m) revalidatePath(`/p/${m.project_id}`);
  revalidatePath("/ledger");
}

export async function draftContractAction(brief: string, budget: number, currency: string) {
  return attempt(() => draftContract(brief, budget, currency));
}

export type ContractInput = {
  draft: DraftContract;
  client_name: string;
  client_email: string;
  freelancer_name: string;
  freelancer_email: string;
  currency: string;
  auto_release: boolean;
};

export async function createContractAction(input: ContractInput) {
  const id = db.createProject(
    {
      title: input.draft.title,
      summary: input.draft.summary,
      client_name: input.client_name,
      client_email: input.client_email,
      freelancer_name: input.freelancer_name,
      freelancer_email: input.freelancer_email,
      currency: input.currency,
      auto_release: input.auto_release ? 1 : 0,
    },
    input.draft.milestones.map((m) => ({
      ...m,
      criteria: m.criteria.map((text, i) => ({ id: `c${i + 1}`, text })),
    })),
  );
  revalidatePath("/");
  redirect(`/p/${id}`);
}

export async function startFundingAction(milestoneId: string) {
  return attempt(() => escrow.startFunding(milestoneId));
}

export async function completeFundingAction(milestoneId: string, orderId: string) {
  const r = await attempt(() => escrow.completeFunding(milestoneId, orderId));
  refresh(milestoneId);
  return r;
}

export async function submitWorkAction(milestoneId: string, note: string, links: string[], image: string | null) {
  const r = await attempt(async () => {
    const m = db.requireMilestone(milestoneId);
    const p = db.getProject(m.project_id)!;
    if (!["funded", "revision"].includes(m.status)) throw new Error(`Cannot submit while milestone is ${m.status}`);
    const subId = db.addSubmission(milestoneId, note, links, image);
    db.updateMilestone(milestoneId, { status: "submitted" });
    db.logEvent({ project_id: p.id, milestone_id: milestoneId, type: "work_submitted", actor: "freelancer", message: `${p.freelancer_name} submitted work for review` });

    const submission = db.getSubmissions(milestoneId).find((s) => s.id === subId)!;
    const { verdict, inspected } = await verifySubmission(m, submission);
    db.setVerdict(subId, verdict);
    const met = verdict.criteria.filter((c) => c.met).length;
    db.logEvent({
      project_id: p.id,
      milestone_id: milestoneId,
      type: "ai_verdict",
      actor: "ai",
      message: `Verifier: ${verdict.overall.toUpperCase()} — ${met}/${verdict.criteria.length} criteria met (confidence ${Math.round(verdict.confidence * 100)}%). Inspected ${inspected.length} source(s).`,
    });

    if (verdict.overall === "fail") {
      db.updateMilestone(milestoneId, { status: "revision" });
    } else if (verdict.overall === "pass" && p.auto_release && verdict.confidence >= 0.8) {
      const amount = escrow.remaining(m);
      await executeSettlement(
        milestoneId,
        `The Delivery Verifier passed this milestone with ${Math.round(verdict.confidence * 100)}% confidence and the client enabled auto-release. ` +
          `Release the full remaining escrow (${amount} ${p.currency}) to the freelancer. Verifier summary: ${verdict.summary}`,
      );
    } else {
      db.updateMilestone(milestoneId, { status: "awaiting_client" });
    }
    return verdict;
  });
  refresh(milestoneId);
  return r;
}

export async function clientReleaseAction(milestoneId: string) {
  const r = await attempt(async () => {
    const m = db.requireMilestone(milestoneId);
    await escrow.release(milestoneId, escrow.remaining(m), `Approved by client: ${m.title}`, "client");
  });
  refresh(milestoneId);
  return r;
}

export async function requestRevisionAction(milestoneId: string, feedback: string) {
  const r = await attempt(async () => {
    const m = db.requireMilestone(milestoneId);
    db.updateMilestone(milestoneId, { status: "revision" });
    db.logEvent({ project_id: m.project_id, milestone_id: milestoneId, type: "revision_requested", actor: "client", message: `Client requested changes: ${feedback}` });
  });
  refresh(milestoneId);
  return r;
}

export async function openDisputeAction(milestoneId: string, statement: string) {
  const r = await attempt(async () => {
    const m = db.requireMilestone(milestoneId);
    db.openDispute(milestoneId, statement);
    db.updateMilestone(milestoneId, { status: "disputed" });
    db.logEvent({ project_id: m.project_id, milestone_id: milestoneId, type: "dispute_opened", actor: "client", message: `Dispute opened: ${statement}` });
  });
  refresh(milestoneId);
  return r;
}

export async function freelancerStatementAction(milestoneId: string, statement: string) {
  const r = await attempt(async () => {
    const m = db.requireMilestone(milestoneId);
    const d = db.getDispute(milestoneId)!;
    db.addStatement(d.id, [...d.statements, { party: "freelancer", text: statement, created_at: new Date().toISOString() }]);
    db.logEvent({ project_id: m.project_id, milestone_id: milestoneId, type: "dispute_response", actor: "freelancer", message: `Freelancer responded: ${statement}` });
  });
  refresh(milestoneId);
  return r;
}

export async function mediateAction(milestoneId: string) {
  const r = await attempt(async () => {
    const m = db.requireMilestone(milestoneId);
    const p = db.getProject(m.project_id)!;
    const d = db.getDispute(milestoneId)!;
    const ruling = await mediate(milestoneId);
    db.setRuling(d.id, ruling);
    db.logEvent({
      project_id: p.id,
      milestone_id: milestoneId,
      type: "ai_ruling",
      actor: "ai",
      message: `Mediator ruling: freelancer earned ${ruling.freelancer_share_pct}% → release ${ruling.release_amount}, refund ${ruling.refund_amount} ${p.currency}`,
    });
    await executeSettlement(
      milestoneId,
      `A binding mediation ruling was issued. Execute it exactly: release ${ruling.release_amount} ${p.currency} to the freelancer` +
        ` and refund ${ruling.refund_amount} ${p.currency} to the client (skip any zero amount). Ruling reasoning: ${ruling.reasoning}`,
    );
    return ruling;
  });
  refresh(milestoneId);
  return r;
}

export async function loadDemoAction() {
  const id = db.createProject(
    {
      title: "Bakery landing page + online pre-orders",
      summary:
        "Maria's Bakery needs a one-page website that showcases the menu and lets customers pre-order cakes for pickup, paid with PayPal.",
      client_name: "Maria (Maria's Bakery)",
      client_email: process.env.DEMO_CLIENT_EMAIL ?? "client@example.com",
      freelancer_name: "Sam Rivera",
      freelancer_email: process.env.DEMO_FREELANCER_EMAIL ?? "freelancer@example.com",
      currency: "USD",
      auto_release: 1,
    },
    [
      {
        title: "Design & live landing page",
        description: "Responsive one-page site with hero, menu, hours and location, deployed to a public URL.",
        amount: 150,
        due_days: 5,
        criteria: [
          { id: "c1", text: "Site is live at a public URL" },
          { id: "c2", text: "Page includes a menu section with at least 5 items and prices" },
          { id: "c3", text: "Opening hours and address are shown" },
          { id: "c4", text: "Page declares a mobile viewport so it renders responsively on phones" },
        ],
      },
      {
        title: "Cake pre-order flow with PayPal",
        description: "Order form for custom cakes with pickup date, paid via PayPal Checkout.",
        amount: 250,
        due_days: 10,
        criteria: [
          { id: "c1", text: "Source code is in a public GitHub repository with a README explaining setup" },
          { id: "c2", text: "Repository contains a PayPal Checkout integration (orders create + capture)" },
          { id: "c3", text: "Order form collects cake type, size and pickup date" },
        ],
      },
    ],
  );
  revalidatePath("/");
  redirect(`/p/${id}`);
}
