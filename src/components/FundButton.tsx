"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { completeFundingAction, startFundingAction } from "@/app/actions";

export function FundButton({ milestoneId, clientId, currency }: { milestoneId: string; clientId: string; currency: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!clientId) return <p className="text-sm text-bad">Set PAYPAL_CLIENT_ID to enable funding.</p>;
  return (
    <div className="max-w-xs">
      <PayPalScriptProvider options={{ clientId, currency, intent: "capture" }}>
        <PayPalButtons
          style={{ layout: "horizontal", height: 40, tagline: false, label: "pay" }}
          fundingSource="paypal"
          createOrder={async () => {
            setError(null);
            const r = await startFundingAction(milestoneId);
            if (!r.ok) throw new Error(r.error);
            return r.data;
          }}
          onApprove={async (data) => {
            const r = await completeFundingAction(milestoneId, data.orderID);
            if (!r.ok) setError(r.error);
            router.refresh();
          }}
          onError={(e) => setError(String(e))}
        />
      </PayPalScriptProvider>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
