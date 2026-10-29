import Link from "next/link";
import { listProjects } from "@/lib/db";
import { Card, money } from "@/components/ui";
import { loadDemoAction } from "./actions";

export const dynamic = "force-dynamic";

const steps = [
  ["Describe the job", "An AI Contract Architect turns a plain-English brief into milestones with objective acceptance criteria."],
  ["Fund with PayPal", "The client pays each milestone with PayPal Checkout. The money is held in escrow, not sent yet."],
  ["AI verifies delivery", "A Verifier agent inspects the live site, repo or screenshots against every criterion and cites evidence."],
  ["Agent settles", "A Settlement agent pays the freelancer via PayPal Payouts, or refunds or splits disputed funds after a binding AI ruling."],
];

export default function Home() {
  const projects = listProjects();
  return (
    <div className="space-y-12">
      <section className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div className="space-y-5">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Get paid for freelance work, without needing to trust a stranger.
          </h1>
          <p className="text-lg text-ink-soft">
            Vouch is milestone escrow on PayPal run by AI agents. They draft the contract, check the work and move the money,
            with no 10–20% marketplace commission on top.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/new" className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-ink/90">
              Start a contract
            </Link>
            <form action={loadDemoAction}>
              <button className="rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-medium hover:bg-paper">
                Load demo contract
              </button>
            </form>
          </div>
        </div>
        <Card className="p-5">
          <ol className="space-y-4">
            {steps.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
                  {i + 1}
                </span>
                <div>
                  <div className="font-medium">{t}</div>
                  <div className="text-sm text-ink-soft">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">What a $2,000 job costs the freelancer</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Freelance marketplace commission (10–20%)</dt>
              <dd className="font-semibold text-bad">$200–$400</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Vouch commission</dt>
              <dd className="font-semibold text-ok">$0</dd>
            </div>
          </dl>
          <p className="text-xs text-ink-soft">
            Only PayPal&apos;s standard processing and payout fees apply. The AI review of a milestone costs cents in
            model usage, not a percentage of the job.
          </p>
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">How the money is held</h2>
          <p className="text-sm text-ink-soft">
            In this prototype, each milestone is captured with PayPal Checkout into the platform&apos;s sandbox business
            account, then released with PayPal Payouts or returned with a refund. Each payout and refund is confirmed with PayPal through signed webhooks, with polling as a
            fallback.
          </p>
          <p className="text-sm text-ink-soft">
            In production, Vouch runs on <span className="font-medium text-ink">PayPal Multiparty</span>: freelancers onboard
            as sellers, and delayed disbursement keeps each milestone&apos;s funds with PayPal until the agents release them.
            Vouch never takes custody of the money.
          </p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Contracts</h2>
        {projects.length === 0 ? (
          <Card className="p-8 text-center text-sm text-ink-soft">
            No contracts yet. Start one, or load the demo contract to see the full flow.
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`}>
                <Card className="space-y-3 p-5 transition hover:border-brand/40 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium">{p.title}</div>
                    <div className="text-sm font-semibold">{money(p.total, p.currency)}</div>
                  </div>
                  <div className="text-sm text-ink-soft">
                    {p.client_name} → {p.freelancer_name}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-paper">
                    <div className="h-full bg-ok" style={{ width: `${p.total ? (p.released / p.total) * 100 : 0}%` }} />
                  </div>
                  <div className="flex gap-4 text-xs text-ink-soft">
                    <span>Paid out {money(p.released, p.currency)}</span>
                    <span>In escrow {money(p.escrowed, p.currency)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
