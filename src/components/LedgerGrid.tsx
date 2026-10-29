"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi } from "ag-grid-community";
import { AgCharts } from "ag-charts-react";
import {
  AllCommunityModule as AllChartsModule,
  ModuleRegistry as ChartsModuleRegistry,
  type AgCartesianChartOptions,
  type AgChartOptions,
} from "ag-charts-community";
import type { LedgerEvent } from "@/lib/db";
import { PENDING_STATUSES, isSettled } from "@/lib/status";
import { Card, money } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);
ChartsModuleRegistry.registerModules([AllChartsModule]);

type Row = LedgerEvent & { project_title: string; milestone_title: string | null; paypal_status: string | null };

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

// One color per money state, shared by the charts, the grid and the stat cards.
const FLOW = { held: "#0f5bd8", paid: "#0f8a5f", refunded: "#c0352b" };

const MONEY_TYPES = { escrow_funded: "funded", payout_sent: "paid", refund_issued: "refunded" } as const;

const chartBase = {
  background: { visible: false },
  padding: { top: 8, right: 8, bottom: 8, left: 8 },
  legend: { position: "bottom" as const, item: { label: { fontSize: 12 } } },
};

function tally(rows: Row[]) {
  const t = { funded: 0, paid: 0, refunded: 0 };
  for (const r of rows) {
    const k = MONEY_TYPES[r.type as keyof typeof MONEY_TYPES];
    if (k) t[k] += r.amount ?? 0;
  }
  return { ...t, held: Math.max(0, t.funded - t.paid - t.refunded) };
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const settled = isSettled(status);
  const pending = PENDING_STATUSES.includes(status);
  const [bg, fg] = settled ? ["#e4f5ee", "#0f8a5f"] : pending ? ["#fdf2e2", "#b45309"] : ["#fbe9e7", "#c0352b"];
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
      {settled ? "✓ " : ""}
      {status}
    </span>
  );
}

export function LedgerGrid({ rows }: { rows: Row[] }) {
  const [quick, setQuick] = useState("");
  const [pinned, setPinned] = useState<Partial<Row>[]>([]);
  const gridRef = useRef<AgGridReact<Row>>(null);

  const totals = useMemo(() => ({ ...tally(rows), aiActions: rows.filter((r) => r.actor === "ai").length }), [rows]);

  const byContract = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(r.project_title, [...(m.get(r.project_title) ?? []), r]);
    return [...m].map(([contract, rs]) => ({ contract, ...tally(rs) })).filter((c) => c.funded > 0);
  }, [rows]);

  // Escrow balance after every money movement, oldest first.
  const timeline = useMemo(() => {
    const moves = rows
      .filter((r) => r.type in MONEY_TYPES)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return moves.reduce<{ time: Date; held: number }[]>((acc, r) => {
      const prev = acc.at(-1)?.held ?? 0;
      const delta = r.type === "escrow_funded" ? (r.amount ?? 0) : -(r.amount ?? 0);
      return [...acc, { time: new Date(r.created_at), held: Math.round((prev + delta) * 100) / 100 }];
    }, []);
  }, [rows]);

  const donut: AgChartOptions = useMemo(
    () => ({
      ...chartBase,
      title: { text: "Where the money is", fontSize: 14 },
      data: [
        { state: "Held in escrow", value: totals.held, color: FLOW.held },
        { state: "Paid to freelancers", value: totals.paid, color: FLOW.paid },
        { state: "Refunded to clients", value: totals.refunded, color: FLOW.refunded },
      ].filter((d) => d.value > 0),
      series: [
        {
          type: "donut",
          angleKey: "value",
          legendItemKey: "state",
          innerRadiusRatio: 0.62,
          fills: [FLOW.held, FLOW.paid, FLOW.refunded].filter((_, i) => [totals.held, totals.paid, totals.refunded][i] > 0),
          strokeWidth: 0,
          tooltip: { renderer: ({ datum }) => ({ heading: datum.state, data: [{ label: "Amount", value: money(datum.value) }] }) },
        },
      ],
    }),
    [totals],
  );

  const bars: AgCartesianChartOptions = useMemo(
    () => ({
      ...chartBase,
      title: { text: "Escrow by contract", fontSize: 14 },
      padding: { top: 8, right: 12, bottom: 8, left: 16 },
      subtitle: { text: "Click a bar to filter the ledger", fontSize: 11 },
      data: byContract,
      series: (["paid", "refunded", "held"] as const).map((k) => ({
        type: "bar" as const,
        direction: "horizontal" as const,
        xKey: "contract",
        yKey: k,
        yName: k === "held" ? "Held" : k === "paid" ? "Paid out" : "Refunded",
        stacked: true,
        fill: FLOW[k],
        cornerRadius: 3,
        listeners: { seriesNodeClick: ({ datum }: { datum: { contract: string } }) => setQuick(datum.contract) },
        tooltip: {
          renderer: ({ datum }: { datum: Record<string, number | string> }) => ({
            heading: String(datum.contract),
            data: [{ label: k, value: money(Number(datum[k])) }],
          }),
        },
      })),
      axes: {
        x: { type: "number", position: "bottom", label: { formatter: ({ value }: { value: number }) => money(value) } },
        y: {
          type: "category",
          position: "left",
          label: {
            avoidCollisions: true,
            formatter: ({ value }: { value: string }) => (value.length > 16 ? `${value.slice(0, 15)}…` : value),
          },
        },
      },
    }),
    [byContract],
  );

  const area: AgChartOptions = useMemo(
    () => ({
      ...chartBase,
      title: { text: "Escrow balance over time", fontSize: 14 },
      data: timeline,
      series: [
        {
          type: "area",
          xKey: "time",
          yKey: "held",
          yName: "Held in escrow",
          fill: FLOW.held,
          fillOpacity: 0.18,
          stroke: FLOW.held,
          strokeWidth: 2,
          interpolation: { type: "step", position: "end" },
          marker: { enabled: true, size: 5, fill: FLOW.held },
        },
      ],
      axes: {
        x: { type: "time", position: "bottom" },
        y: { type: "number", position: "left", label: { formatter: ({ value }: { value: number }) => money(value) } },
      },
      legend: { enabled: false },
    }),
    [timeline],
  );

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      {
        field: "created_at",
        headerName: "Time",
        sort: "desc",
        width: 170,
        valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : ""),
      },
      { field: "project_title", headerName: "Contract", flex: 1, minWidth: 180, filter: true },
      { field: "milestone_title", headerName: "Milestone", flex: 1, minWidth: 160, filter: true },
      {
        field: "actor",
        width: 120,
        filter: true,
        cellRenderer: (p: { value?: string }) =>
          p.value ? (
            <span style={{ color: actorColors[p.value], fontWeight: 600, textTransform: "uppercase", fontSize: 12 }}>
              {p.value === "ai" ? "✦ AI" : p.value}
            </span>
          ) : null,
      },
      { field: "type", width: 160, filter: true },
      {
        field: "amount",
        width: 120,
        type: "rightAligned",
        valueFormatter: (p) => (p.value == null ? "" : money(p.value)),
        cellStyle: (p) => ({
          color:
            p.data?.type === "refund_issued" ? FLOW.refunded : p.data?.type === "payout_sent" ? FLOW.paid : "inherit",
          fontWeight: 600,
        }),
      },
      { field: "paypal_ref", headerName: "PayPal ID", width: 190, cellClass: "font-mono text-xs" },
      {
        field: "paypal_status",
        headerName: "PayPal status",
        width: 150,
        filter: true,
        cellRenderer: (p: { value: string | null }) => <StatusBadge status={p.value} />,
      },
      { field: "message", flex: 2, minWidth: 300, tooltipField: "message" },
    ],
    [],
  );

  // Totals for exactly the rows the filters and search leave visible.
  const updatePinned = useCallback((api: GridApi<Row>) => {
    const shown: Row[] = [];
    api.forEachNodeAfterFilter((n) => n.data && shown.push(n.data));
    const t = tally(shown);
    setPinned([
      {
        project_title: `Totals · ${shown.length} events`,
        message: `Funded ${money(t.funded)} · Paid out ${money(t.paid)} · Refunded ${money(t.refunded)} · Held ${money(t.held)}`,
      },
    ]);
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Held in escrow", money(totals.held), FLOW.held],
          ["Paid out to freelancers", money(totals.paid), FLOW.paid],
          ["Refunded to clients", money(totals.refunded), FLOW.refunded],
          ["Autonomous AI actions", String(totals.aiActions), "#6d3fd1"],
        ].map(([l, v, c]) => (
          <Card key={l} className="p-4">
            <div className="text-xs text-ink-soft">{l}</div>
            <div className="text-xl font-semibold" style={{ color: c }}>
              {v}
            </div>
          </Card>
        ))}
      </div>

      {timeline.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-3">
          {[donut, bars, area].map((options, i) => (
            <Card key={i} className="h-72 p-2">
              <AgCharts options={options} style={{ height: "100%" }} />
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-full max-w-sm rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder="Search the ledger…"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
        {quick && (
          <button className="text-sm text-brand hover:underline" onClick={() => setQuick("")}>
            Clear filter
          </button>
        )}
        <button
          className="ml-auto rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium hover:bg-paper"
          onClick={() =>
            gridRef.current?.api.exportDataAsCsv({ fileName: "vouch-escrow-ledger.csv", skipPinnedBottom: true })
          }
        >
          Export CSV
        </button>
      </div>
      <div style={{ height: 560 }}>
        <AgGridReact<Row>
          ref={gridRef}
          theme={theme}
          rowData={rows}
          columnDefs={cols}
          quickFilterText={quick}
          pagination
          paginationPageSize={20}
          enableCellTextSelection
          tooltipShowDelay={300}
          pinnedBottomRowData={pinned as Row[]}
          onModelUpdated={(e) => updatePinned(e.api)}
          getRowStyle={(p) => (p.node.rowPinned ? { fontWeight: 600, background: "#f6f7f9" } : undefined)}
        />
      </div>
    </div>
  );
}
