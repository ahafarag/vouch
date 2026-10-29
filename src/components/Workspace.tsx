"use client";

import Link from "next/link";
import type { Dispute, LedgerEvent, Milestone, Project, Submission } from "@/lib/db";
import { Card, cx, money } from "./ui";
import { MilestoneCard } from "./MilestoneCard";

export type Role = "client" | "freelancer";
export type MilestoneView = Milestone & { submissions: Submission[]; dispute: Dispute | null };

const actorStyle: Record<string, [string, string]> = {
  client: ["C", "bg-brand-soft text-brand"],
  freelancer: ["F", "bg-ok-soft text-ok"],
  ai: ["✦", "bg-ai-soft text-ai"],
  paypal: ["P", "bg-[#ffc439]/30 text-[#003087]"],
  system: ["•", "bg-paper text-ink-soft"],
};

export function Workspace({
  project,
  milestones,
  events,
  role,
  paypalClientId,
  model,
}: {
  project: Project;
  milestones: MilestoneView[];
  events: LedgerEvent[];
  role: Role;
  paypalClientId: string;
  model: string;
}) {
  const sum = (f: (m: Milestone) => number) => milestones.reduce((s, m) => s + f(m), 0);
  const total = sum((m) => m.amount);
  const escrowed = sum((m) => (m.capture_id ? m.amount - m.released - m.refunded : 0));
  const stats = [
    ["Contract value", total],
    ["Held in escrow", escrowed],
    ["Paid to freelancer", sum((m) => m.released)],
    ["Refunded to client", sum((m) => m.refunded)],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1">
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <p className="text-sm text-ink-soft">{project.summary}</p>
          <p className="text-sm">
            <span className="text-ink-soft">Client</span> {project.client_name} ·{" "}
            <span className="text-ink-soft">Freelancer</span> {project.freelancer_name}
          </p>
        </div>
        <div className="flex rounded-lg border border-line bg-white p-1 text-sm">
          {(["client", "freelancer"] as const).map((r) => (
            <Link
              key={r}
              href={`?as=${r}`}
              scroll={false}
              className={cx("rounded-md px-3 py-1.5 capitalize", role === r ? "bg-ink text-white" : "text-ink-soft hover:text-ink")}
            >
              View as {r}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map(([label, v]) => (
          <Card key={label} className="p-4">
            <div className="text-xs text-ink-soft">{label}</div>
            <div className="text-xl font-semibold">{money(v, project.currency)}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {milestones.map((m) => (
            <MilestoneCard key={m.id} m={m} project={project} role={role} paypalClientId={paypalClientId} />
          ))}
        </div>
        <Card className="h-fit p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Activity</h2>
            <span className="text-[11px] text-ink-soft">AI: {model}</span>
          </div>
          <ol className="space-y-3">
            {events.map((e) => {
              const [icon, cls] = actorStyle[e.actor] ?? actorStyle.system;
              return (
                <li key={e.id} className="flex gap-2.5 text-sm">
                  <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", cls)}>{icon}</span>
                  <div className="min-w-0">
                    <p className="line-clamp-4 break-words">{e.message}</p>
                    <p className="text-xs text-ink-soft">
                      {new Date(e.created_at).toLocaleString()}
                      {e.amount != null && ` · ${money(e.amount, project.currency)}`}
                      {e.paypal_ref && <span className="font-mono"> · {e.paypal_ref}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
