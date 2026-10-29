"use client";

import { useState, useTransition } from "react";
import { createContractAction, draftContractAction } from "../actions";
import type { DraftContract } from "@/lib/agents/architect";
import { AiTag, Button, Card, money } from "@/components/ui";

const EXAMPLE =
  "I run a small bakery and need a simple website: show our menu with prices, opening hours and address, " +
  "and let people pre-order custom cakes for pickup and pay online with PayPal. I'd like to see the design live first before the ordering part is built.";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand";

export default function NewContract() {
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState(400);
  const [draft, setDraft] = useState<DraftContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parties, setParties] = useState({
    client_name: "",
    client_email: "",
    freelancer_name: "",
    freelancer_email: "",
  });
  const [autoRelease, setAutoRelease] = useState(true);
  const [drafting, startDraft] = useTransition();
  const [creating, startCreate] = useTransition();

  const total = draft?.milestones.reduce((s, m) => s + m.amount, 0) ?? 0;

  function generate() {
    setError(null);
    startDraft(async () => {
      const r = await draftContractAction(brief, budget, "USD");
      if (r.ok) setDraft(r.data);
      else setError(r.error);
    });
  }

  function updateMilestone(i: number, patch: Partial<DraftContract["milestones"][number]>) {
    setDraft((d) => d && { ...d, milestones: d.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New contract</h1>
        <p className="text-sm text-ink-soft">Describe the job the way you&apos;d text a friend. The Contract Architect handles the structure.</p>
      </div>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Job brief</label>
          <button className="text-xs text-brand hover:underline" onClick={() => setBrief(EXAMPLE)}>
            Use example
          </button>
        </div>
        <textarea className={`${input} h-32`} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What do you need built?" />
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-sm font-medium">Total budget (USD)</label>
            <input type="number" className={`${input} w-40`} value={budget} min={10} onChange={(e) => setBudget(Number(e.target.value))} />
          </div>
          <Button variant="ai" onClick={generate} loading={drafting} disabled={brief.trim().length < 20}>
            ✦ Draft milestones with AI
          </Button>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
      </Card>

      {draft && (
        <>
          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-2">
              <AiTag>Drafted</AiTag>
              <span className="text-xs text-ink-soft">Everything below is editable</span>
            </div>
            <input className={`${input} text-base font-semibold`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea className={`${input} h-20`} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />

            {draft.milestones.map((m, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-line p-4">
                <div className="flex gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-paper text-xs font-semibold">{i + 1}</span>
                  <input className={input} value={m.title} onChange={(e) => updateMilestone(i, { title: e.target.value })} />
                  <input
                    type="number"
                    className={`${input} w-28`}
                    value={m.amount}
                    onChange={(e) => updateMilestone(i, { amount: Number(e.target.value) })}
                  />
                </div>
                <p className="text-sm text-ink-soft">{m.description} · due {m.due_days} days after funding</p>
                <ul className="space-y-1">
                  {m.criteria.map((c, j) => (
                    <li key={j} className="flex gap-2 text-sm">
                      <span className="text-ok">✓</span>
                      <input
                        className="w-full border-b border-transparent bg-transparent outline-none focus:border-line"
                        value={c}
                        onChange={(e) =>
                          updateMilestone(i, { criteria: m.criteria.map((x, k) => (k === j ? e.target.value : x)) })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="flex justify-between text-sm">
              <span className="text-ink-soft">Total</span>
              <span className={total === budget ? "font-semibold" : "font-semibold text-warn"}>
                {money(total)} {total !== budget && `(budget ${money(budget)})`}
              </span>
            </div>

            {draft.risks.length > 0 && (
              <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
                <div className="mb-1 font-medium">Clarify before funding</div>
                <ul className="list-disc pl-5">
                  {draft.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ["client_name", "Client name"],
                  ["client_email", "Client PayPal email"],
                  ["freelancer_name", "Freelancer name"],
                  ["freelancer_email", "Freelancer PayPal email (receives payouts)"],
                ] as const
              ).map(([k, label]) => (
                <div key={k}>
                  <label className="text-sm font-medium">{label}</label>
                  <input className={input} value={parties[k]} onChange={(e) => setParties({ ...parties, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={autoRelease} onChange={(e) => setAutoRelease(e.target.checked)} className="mt-1" />
              <span>
                <span className="font-medium">Auto-release on AI approval.</span>{" "}
                <span className="text-ink-soft">
                  If the Verifier passes a milestone with ≥80% confidence, funds go to the freelancer right away. Both parties agree that
                  AI mediation of disputes is binding.
                </span>
              </span>
            </label>
            <Button
              className="w-full"
              loading={creating}
              disabled={!parties.client_name || !parties.freelancer_email || !parties.freelancer_name}
              onClick={() =>
                startCreate(() =>
                  createContractAction({ draft, ...parties, currency: "USD", auto_release: autoRelease }),
                )
              }
            >
              Create contract
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
