"use client";

import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import type { LedgerEvent } from "@/lib/db";
import { Card, money } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = LedgerEvent & { project_title: string; milestone_title: string | null };

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  headerBackgroundColor: "#f6f7f9",
  borderColor: "#e3e7ee",
  accentColor: "#0f5bd8",
});

const actorColors: Record<string, string> = {
  client: "#0f5bd8",
  freelancer: "#0f8a5f",
  ai: "#6d3fd1",
  paypal: "#003087",
};

export function LedgerGrid({ rows }: { rows: Row[] }) {
  const [quick, setQuick] = useState("");

  const totals = useMemo(() => {
    const t = { funded: 0, paid: 0, refunded: 0, aiActions: 0 };
    for (const r of rows) {
      if (r.type === "escrow_funded") t.funded += r.amount ?? 0;
      if (r.type === "payout_sent") t.paid += r.amount ?? 0;
      if (r.type === "refund_issued") t.refunded += r.amount ?? 0;
      if (r.actor === "ai") t.aiActions++;
    }
    return t;
  }, [rows]);

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      {
        field: "created_at",
        headerName: "Time",
        sort: "desc",
        width: 170,
        valueFormatter: (p) => new Date(p.value).toLocaleString(),
      },
      { field: "project_title", headerName: "Contract", flex: 1, minWidth: 180, filter: true },
      { field: "milestone_title", headerName: "Milestone", flex: 1, minWidth: 160, filter: true },
      {
        field: "actor",
        width: 120,
        filter: true,
        cellRenderer: (p: { value: string }) => (
          <span style={{ color: actorColors[p.value], fontWeight: 600, textTransform: "uppercase", fontSize: 12 }}>
            {p.value === "ai" ? "✦ AI" : p.value}
          </span>
        ),
      },
      { field: "type", width: 150, filter: true },
      {
        field: "amount",
        width: 120,
        type: "rightAligned",
        valueFormatter: (p) => (p.value == null ? "" : money(p.value)),
        cellStyle: (p) => ({
          color: p.data?.type === "refund_issued" ? "#c0352b" : p.data?.type === "payout_sent" ? "#0f8a5f" : "inherit",
          fontWeight: 600,
        }),
      },
      { field: "paypal_ref", headerName: "PayPal ID", width: 190, cellClass: "font-mono text-xs" },
      { field: "message", flex: 2, minWidth: 300, tooltipField: "message" },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Funded into escrow", money(totals.funded)],
          ["Paid out to freelancers", money(totals.paid)],
          ["Refunded to clients", money(totals.refunded)],
          ["Autonomous AI actions", String(totals.aiActions)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="text-xs text-ink-soft">{l}</div>
            <div className="text-xl font-semibold">{v}</div>
          </Card>
        ))}
      </div>
      <input
        className="w-full max-w-sm rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
        placeholder="Search the ledger…"
        value={quick}
        onChange={(e) => setQuick(e.target.value)}
      />
      <div style={{ height: 560 }}>
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={cols}
          quickFilterText={quick}
          pagination
          paginationPageSize={20}
          enableCellTextSelection
          tooltipShowDelay={300}
        />
      </div>
    </div>
  );
}
