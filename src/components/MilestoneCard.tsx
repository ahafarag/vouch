"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Project, Verdict } from "@/lib/db";
import {
  clientReleaseAction,
  freelancerStatementAction,
  mediateAction,
  openDisputeAction,
  requestRevisionAction,
  submitWorkAction,
} from "@/app/actions";
import { AiTag, Button, Card, StatusBadge, cx, money } from "./ui";
import { FundButton } from "./FundButton";
import type { MilestoneView, Role } from "./Workspace";

const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong");
      router.refresh();
    });
  return { pending, error, run };
}

// Cycles through what the agent is doing so a 20-60s review doesn't feel frozen.
function AgentProgress({ steps }: { steps: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 4000);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-ai-soft px-3 py-2 text-sm text-ai">
      <span className="h-2 w-2 animate-pulse rounded-full bg-ai" />
      {steps[i]}
    </div>
  );
}

function VerdictReport({ v }: { v: Verdict }) {
  const tone = v.overall === "pass" ? "text-ok" : v.overall === "partial" ? "text-warn" : "text-bad";
  return (
    <div className="space-y-3 rounded-lg border border-ai/20 bg-ai-soft/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <AiTag>Verifier report</AiTag>
        <span className={cx("text-sm font-semibold uppercase", tone)}>{v.overall}</span>
        <span className="text-xs text-ink-soft">confidence {Math.round(v.confidence * 100)}%</span>
      </div>
      <p className="text-sm">{v.summary}</p>
      <ul className="space-y-2">
        {v.criteria.map((c) => (
          <li key={c.id} className="flex gap-2 text-sm">
            <span className={c.met ? "text-ok" : "text-bad"}>{c.met ? "✓" : "✗"}</span>
            <span className="text-ink-soft">{c.evidence}</span>
          </li>
        ))}
      </ul>
      {v.feedback_for_freelancer && (
        <p className="rounded-md bg-white p-2 text-sm">
          <span className="font-medium">What to fix: </span>
          {v.feedback_for_freelancer}
        </p>
      )}
    </div>
  );
}

function SubmitWork({ m }: { m: MilestoneView }) {
  const { pending, error, run } = useAction();
  const [note, setNote] = useState("");
  const [links, setLinks] = useState("");
  const [image, setImage] = useState<string | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return setImage(null);
    // Downscale screenshots so they stay small enough to store and send to the model.
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1280 / bmp.width);
    const c = document.createElement("canvas");
    c.width = bmp.width * scale;
    c.height = bmp.height * scale;
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    setImage(c.toDataURL("image/jpeg", 0.8));
  }

  if (pending)
    return (
      <AgentProgress
        steps={[
          "Verifier agent is reading the acceptance criteria…",
          "Inspecting submitted links…",
          "Checking each criterion against the evidence…",
          "Writing the report…",
          "Settlement agent is confirming the escrow with PayPal…",
          "Almost done…",
        ]}
      />
    );
  return (
    <div className="space-y-2">
      <textarea className={`${field} h-20`} placeholder="What did you deliver? Anything the reviewer should know?" value={note} onChange={(e) => setNote(e.target.value)} />
      <textarea className={`${field} h-16 font-mono text-xs`} placeholder="Links, one per line (live URL, GitHub repo, Figma…)" value={links} onChange={(e) => setLinks(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept="image/*" className="text-xs" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button
          variant="ai"
          className="ml-auto"
          disabled={!note.trim()}
          onClick={() =>
            run(() => submitWorkAction(m.id, note, links.split(/\s+/).filter((l) => /^https?:\/\//.test(l)), image))
          }
        >
          Submit for AI review
        </Button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function TextAction({
  placeholder,
  label,
  variant = "secondary",
  onSubmit,
}: {
  placeholder: string;
  label: string;
  variant?: "secondary" | "danger" | "primary";
  onSubmit: (text: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { pending, error, run } = useAction();
  if (!open)
    return (
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <div className="w-full space-y-2">
      <textarea className={`${field} h-20`} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2">
        <Button variant={variant} loading={pending} disabled={!text.trim()} onClick={() => run(() => onSubmit(text))}>
          {label}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function DisputePanel({ m, role, currency }: { m: MilestoneView; role: Role; currency: string }) {
  const d = m.dispute!;
  const { pending, error, run } = useAction();
  const freelancerReplied = d.statements.some((s) => s.party === "freelancer");
  return (
    <div className="space-y-3 rounded-lg border border-bad/20 bg-bad-soft/40 p-4">
      <div className="text-sm font-semibold text-bad">Dispute</div>
      {d.statements.map((s, i) => (
        <div key={i} className="text-sm">
          <span className="font-medium capitalize">{s.party}: </span>
          {s.text}
        </div>
      ))}
      {d.ruling && (
        <div className="space-y-1 rounded-md bg-white p-3 text-sm">
          <div className="flex items-center gap-2">
            <AiTag>Binding ruling</AiTag>
            <span className="font-semibold">
              Freelancer {d.ruling.freelancer_share_pct}% · release {money(d.ruling.release_amount, currency)} · refund{" "}
              {money(d.ruling.refund_amount, currency)}
            </span>
          </div>
          <p className="text-ink-soft">{d.ruling.reasoning}</p>
        </div>
      )}
      {!d.ruling && (
        <div className="flex flex-wrap gap-2">
          {role === "freelancer" && !freelancerReplied && (
            <TextAction
              label="Respond to dispute"
              variant="primary"
              placeholder="Your side: what you delivered and why it meets the criteria"
              onSubmit={(t) => freelancerStatementAction(m.id, t)}
            />
          )}
          {pending ? (
            <AgentProgress
              steps={[
                "Mediator is weighing both statements against the contract…",
                "Reviewing the verifier's evidence…",
                "Issuing a ruling…",
                "Settlement agent is verifying the escrow order with PayPal…",
                "Executing payout and refund…",
              ]}
            />
          ) : (
            <Button variant="ai" onClick={() => run(() => mediateAction(m.id))}>
              ✦ Request binding AI ruling{!freelancerReplied && " (freelancer hasn't responded)"}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

export function MilestoneCard({
  m,
  project,
  role,
  paypalClientId,
}: {
  m: MilestoneView;
  project: Project;
  role: Role;
  paypalClientId: string;
}) {
  const release = useAction();
  const latest = m.submissions.at(-1);
  const remaining = m.amount - m.released - m.refunded;
  const canDispute = role === "client" && ["funded", "revision", "awaiting_client"].includes(m.status) && !m.dispute;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-ink-soft">Milestone {m.idx + 1}</div>
          <div className="font-semibold">{m.title}</div>
          <p className="text-sm text-ink-soft">{m.description}</p>
        </div>
        <div className="shrink-0 space-y-1 text-right">
          <div className="text-lg font-semibold">{money(m.amount, project.currency)}</div>
          <StatusBadge status={m.status} />
        </div>
      </div>

      <ul className="space-y-1 rounded-lg bg-paper p-3">
        {m.criteria.map((c) => (
          <li key={c.id} className="flex gap-2 text-sm">
            <span className="text-ink-soft">□</span>
            {c.text}
          </li>
        ))}
      </ul>

      {(m.released > 0 || m.refunded > 0) && (
        <div className="flex gap-4 text-sm">
          {m.released > 0 && <span className="text-ok">Paid {money(m.released, project.currency)} via PayPal Payouts</span>}
          {m.refunded > 0 && <span className="text-ink-soft">Refunded {money(m.refunded, project.currency)}</span>}
        </div>
      )}

      {latest?.verdict && <VerdictReport v={latest.verdict} />}
      {m.dispute && <DisputePanel m={m} role={role} currency={project.currency} />}

      {/* Actions by status and role */}
      {m.status === "draft" &&
        (role === "client" ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">Fund this milestone. The money is held in escrow until the work is verified.</p>
            <FundButton milestoneId={m.id} clientId={paypalClientId} currency={project.currency} />
          </div>
        ) : (
          <p className="text-sm text-ink-soft">Waiting for the client to fund escrow before you start.</p>
        ))}

      {(m.status === "funded" || m.status === "revision") &&
        (role === "freelancer" ? (
          <SubmitWork m={m} />
        ) : (
          <p className="text-sm text-ink-soft">
            {money(remaining, project.currency)} is safe in escrow. You&apos;ll be notified when {project.freelancer_name} submits.
          </p>
        ))}

      {m.status === "awaiting_client" &&
        (role === "client" ? (
          <div className="flex flex-wrap gap-2">
            <Button loading={release.pending} onClick={() => release.run(() => clientReleaseAction(m.id))}>
              Release {money(remaining, project.currency)}
            </Button>
            <TextAction label="Request changes" placeholder="What needs to change?" onSubmit={(t) => requestRevisionAction(m.id, t)} />
          </div>
        ) : (
          <p className="text-sm text-ink-soft">The AI review is done. Waiting for the client to confirm.</p>
        ))}

      {canDispute && (
        <TextAction
          label="Open dispute"
          variant="danger"
          placeholder="What went wrong? The AI mediator will weigh this against the contract."
          onSubmit={(t) => openDisputeAction(m.id, t)}
        />
      )}
      {release.error && <p className="text-sm text-bad">{release.error}</p>}
    </Card>
  );
}
