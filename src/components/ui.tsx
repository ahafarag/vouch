import type { MilestoneStatus } from "@/lib/db";

export function money(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("rounded-xl border border-line bg-white", className)}>{children}</div>;
}

type Variant = "primary" | "secondary" | "danger" | "ai";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink/90",
  secondary: "border border-line bg-white text-ink hover:bg-paper",
  danger: "border border-bad/30 bg-white text-bad hover:bg-bad-soft",
  ai: "bg-ai text-white hover:bg-ai/90",
};

export function Button({
  variant = "primary",
  className,
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

const statusStyle: Record<MilestoneStatus, [string, string]> = {
  draft: ["Awaiting funding", "bg-paper text-ink-soft"],
  funded: ["In escrow", "bg-brand-soft text-brand"],
  submitted: ["AI reviewing", "bg-ai-soft text-ai"],
  revision: ["Changes requested", "bg-warn-soft text-warn"],
  awaiting_client: ["Client review", "bg-warn-soft text-warn"],
  disputed: ["Disputed", "bg-bad-soft text-bad"],
  released: ["Paid out", "bg-ok-soft text-ok"],
  refunded: ["Refunded", "bg-paper text-ink-soft"],
  split: ["Settled (split)", "bg-ok-soft text-ok"],
};

export function StatusBadge({ status }: { status: MilestoneStatus }) {
  const [label, cls] = statusStyle[status];
  return <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>{label}</span>;
}

export function AiTag({ children = "AI" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ai">
      ✦ {children}
    </span>
  );
}
