"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { completeFundingAction, startFundingAction } from "@/app/actions";

// One SDK script per page: a provider per button makes the scripts race and only one button renders.
export function PayPalProvider({ clientId, currency, children }: { clientId: string; currency: string; children: ReactNode }) {
  if (!clientId) return children;
  return <PayPalScriptProvider options={{ clientId, currency, intent: "capture" }}>{children}</PayPalScriptProvider>;
}

export function FundButton({ milestoneId, clientId }: { milestoneId: string; clientId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!clientId) return <p className="text-sm text-bad">Set PAYPAL_CLIENT_ID to enable funding.</p>;
  return (
    <div className="max-w-xs">
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
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
