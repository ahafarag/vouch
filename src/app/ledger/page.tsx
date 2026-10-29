import { getEvents } from "@/lib/db";
import { LedgerGrid } from "@/components/LedgerGrid";

export const dynamic = "force-dynamic";

export default function LedgerPage() {
  const events = getEvents();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Escrow ledger</h1>
        <p className="text-sm text-ink-soft">
          Every human, AI and PayPal action across all contracts, with PayPal capture, payout and refund IDs for audit.
        </p>
      </div>
      <LedgerGrid rows={events} />
    </div>
  );
}
