import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Printer, RefreshCw } from "lucide-react";
import logo from "@/assets/bevi-logo.jpg";

export const Route = createFileRoute("/_authenticated/sales-summary")({
  component: SalesSummaryPage,
});

const db = supabase as any;
const SHOP_NAME = "Bevi & Go";
const SHOP_TAGLINE = "Daily Sales Summary";

const todayIso = () => new Date().toISOString().slice(0, 10);
const peso = (n: number) => `₱${Number(n || 0).toFixed(2)}`;

type Mode = "day" | "range";

function SalesSummaryPage() {
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(todayIso());
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [pays, setPays] = useState<any[]>([]);
  const [pms, setPms] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [prevTotal, setPrevTotal] = useState(0);

  const range = useMemo(() => {
    if (mode === "day") return { from: day, to: day };
    return { from, to };
  }, [mode, day, from, to]);

  async function load() {
    setLoading(true);
    const fromTs = `${range.from}T00:00:00`;
    const toTs = `${range.to}T23:59:59`;
    const [{ data: o }, { data: pmList }] = await Promise.all([
      db.from("orders").select("id,total,subtotal,discount_total,status,created_at")
        .gte("created_at", fromTs).lte("created_at", toTs),
      db.from("payment_methods").select("code,label"),
    ]);
    const list = (o ?? []) as any[];
    setOrders(list);
    setPms((pmList ?? []) as any[]);

    const ids = list.map((r) => r.id);
    if (ids.length) {
      const [{ data: its }, { data: ps }] = await Promise.all([
        db.from("order_items").select("order_id,qty,line_total,name_snapshot,menu_items(category_id,categories(name))").in("order_id", ids),
        db.from("order_payments").select("order_id,method_code,amount").in("order_id", ids),
      ]);
      setItems((its ?? []) as any[]);
      setPays((ps ?? []) as any[]);
    } else {
      setItems([]); setPays([]);
    }

    // Expenses via tc_admin_shifts within range
    const { data: shifts } = await db.rpc("tc_admin_shifts", {
      p_from: range.from, p_to: range.to, p_user_id: null,
    });
    const sids = (shifts ?? []).map((s: any) => s.shift_id);
    if (sids.length) {
      const { data: exp } = await db.from("shift_expenses")
        .select("description,amount,category,shift_id").in("shift_id", sids);
      setExpenses((exp ?? []) as any[]);
    } else {
      setExpenses([]);
    }

    // Prior period
    const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1);
    const pf = new Date(new Date(range.from).getTime() - days * 86400000).toISOString().slice(0, 10);
    const pt = new Date(new Date(range.from).getTime() - 86400000).toISOString().slice(0, 10);
    const { data: po } = await db.from("orders").select("total,status")
      .gte("created_at", `${pf}T00:00:00`).lte("created_at", `${pt}T23:59:59`);
    setPrevTotal(((po ?? []) as any[])
      .filter((r) => r.status !== "voided" && r.status !== "refunded")
      .reduce((s, r) => s + Number(r.total || 0), 0));

    setLoading(false);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const live = useMemo(() => orders.filter((o) => o.status !== "voided" && o.status !== "refunded"), [orders]);
  const totals = useMemo(() => {
    const gross = live.reduce((s, o) => s + Number(o.subtotal || 0), 0);
    const disc = live.reduce((s, o) => s + Number(o.discount_total || 0), 0);
    const net = live.reduce((s, o) => s + Number(o.total || 0), 0);
    return { gross, disc, net, count: live.length, avg: live.length ? net / live.length : 0 };
  }, [live]);

  const delta = useMemo(() => {
    if (prevTotal <= 0) return null;
    return ((totals.net - prevTotal) / prevTotal) * 100;
  }, [totals.net, prevTotal]);

  const pmLabel = useMemo(() => {
    const m = new Map<string, string>();
    pms.forEach((p) => m.set(p.code, p.label));
    return m;
  }, [pms]);

  const liveIds = useMemo(() => new Set(live.map((o) => o.id)), [live]);
  const paymentBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    pays.forEach((p) => {
      if (!liveIds.has(p.order_id)) return;
      const k = pmLabel.get(p.method_code) ?? p.method_code ?? "Other";
      m.set(k, (m.get(k) ?? 0) + Number(p.amount || 0));
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pays, liveIds, pmLabel]);

  const itemAgg = useMemo(() => {
    const m = new Map<string, { name: string; category: string; qty: number; revenue: number }>();
    items.forEach((it) => {
      if (!liveIds.has(it.order_id)) return;
      const k = it.name_snapshot;
      const cur = m.get(k) ?? { name: k, category: it.menu_items?.categories?.name ?? "—", qty: 0, revenue: 0 };
      cur.qty += Number(it.qty || 0);
      cur.revenue += Number(it.line_total || 0);
      m.set(k, cur);
    });
    return [...m.values()];
  }, [items, liveIds]);

  const top5 = useMemo(() => [...itemAgg].sort((a, b) => b.qty - a.qty).slice(0, 5), [itemAgg]);
  const bot5 = useMemo(() => [...itemAgg].sort((a, b) => a.qty - b.qty).slice(0, 5), [itemAgg]);
  const catTotals = useMemo(() => {
    const m = new Map<string, number>();
    itemAgg.forEach((r) => m.set(r.category, (m.get(r.category) ?? 0) + r.revenue));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [itemAgg]);
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + Number(e.amount || 0), 0), [expenses]);

  // Rule-based marketing suggestions
  const suggestions = useMemo(() => generateSuggestions({
    top5, bot5, catTotals, totals, delta, paymentBreakdown,
  }), [top5, bot5, catTotals, totals, delta, paymentBreakdown]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3 print:hidden">
        <FileText className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Summary Sales Report</h1>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-3 w-3 mr-1" /> {loading ? "Loading…" : "Refresh"}
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-3 w-3 mr-1" /> Print
          </Button>
        </div>
      </header>

      <Card className="p-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="day">Single day</TabsTrigger>
              <TabsTrigger value="range">Date range</TabsTrigger>
            </TabsList>
          </Tabs>
          {mode === "day" ? (
            <div><Label className="text-xs">Date</Label>
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
          ) : (
            <>
              <div><Label className="text-xs">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label className="text-xs">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </>
          )}
          <Button size="sm" onClick={load} disabled={loading}>Apply</Button>
        </div>
      </Card>

      {/* Printable area */}
      <div id="print-area" className="bg-white text-black rounded-lg border print:border-0 print:rounded-none">
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between border-b pb-4">
            <div className="flex items-center gap-3">
              <img src={logo} alt={SHOP_NAME} className="h-14 w-14 rounded object-cover" />
              <div>
                <div className="text-2xl font-display">{SHOP_NAME}</div>
                <div className="text-sm text-gray-600">{SHOP_TAGLINE}</div>
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="font-semibold">{mode === "day" ? day : `${range.from} → ${range.to}`}</div>
              <div className="text-gray-500">Generated {new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</div>
            </div>
          </div>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Performance</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Orders" value={String(totals.count)} />
              <Kpi label="Gross sales" value={peso(totals.gross)} />
              <Kpi label="Discounts" value={`- ${peso(totals.disc)}`} />
              <Kpi label="Net sales" value={peso(totals.net)}
                hint={delta == null ? "no prior data" :
                  `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}% vs prior`} />
            </div>
            <div className="mt-3 text-sm text-gray-700">
              Average order value: <span className="font-semibold">{peso(totals.avg)}</span>
            </div>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Net by payment method</h2>
              {paymentBreakdown.length === 0 ? <p className="text-sm text-gray-500">No payments.</p> : (
                <table className="w-full text-sm">
                  <tbody>
                    {paymentBreakdown.map(([k, v]) => (
                      <tr key={k} className="border-b last:border-0">
                        <td className="py-1.5">{k}</td>
                        <td className="py-1.5 text-right font-mono">{peso(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Sales by category</h2>
              {catTotals.length === 0 ? <p className="text-sm text-gray-500">No sales.</p> : (
                <table className="w-full text-sm">
                  <tbody>
                    {catTotals.map(([k, v]) => (
                      <tr key={k} className="border-b last:border-0">
                        <td className="py-1.5">{k}</td>
                        <td className="py-1.5 text-right font-mono">{peso(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <RankTable title="Top 5 best sellers" rows={top5} />
            <RankTable title="Bottom 5 movers" rows={bot5} />
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Expenses</h2>
            {expenses.length === 0 ? <p className="text-sm text-gray-500">No expenses recorded.</p> : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-600">
                      <th className="py-1.5">Description</th>
                      <th className="py-1.5">Category</th>
                      <th className="py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5">{e.description}</td>
                        <td className="py-1.5 text-gray-600">{e.category ?? "—"}</td>
                        <td className="py-1.5 text-right font-mono">{peso(e.amount)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-1.5">Total</td>
                      <td />
                      <td className="py-1.5 text-right font-mono">{peso(totalExpenses)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-3 text-sm">
                  Net after expenses: <span className="font-semibold">{peso(totals.net - totalExpenses)}</span>
                </div>
              </>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Marketing suggestions</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm">
              {suggestions.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </section>

          <div className="border-t pt-3 text-xs text-gray-500 text-center">
            {SHOP_NAME} — Summary Sales Report
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border rounded-md p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function RankTable({ title, rows }: { title: string; rows: { name: string; category: string; qty: number; revenue: number }[] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-gray-500">No items.</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-600">
              <th className="py-1.5">Item</th>
              <th className="py-1.5 text-right">Qty</th>
              <th className="py-1.5 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b last:border-0">
                <td className="py-1.5">{r.name}<div className="text-xs text-gray-500">{r.category}</div></td>
                <td className="py-1.5 text-right font-mono">{r.qty}</td>
                <td className="py-1.5 text-right font-mono">{peso(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function generateSuggestions({ top5, bot5, catTotals, totals, delta, paymentBreakdown }: {
  top5: any[]; bot5: any[]; catTotals: [string, number][]; totals: any; delta: number | null;
  paymentBreakdown: [string, number][];
}): string[] {
  const out: string[] = [];
  if (totals.count === 0) return ["No sales in this period — consider a happy-hour promo or social-media campaign to drive traffic."];

  if (delta != null) {
    if (delta < -10) out.push(`Sales dropped ${Math.abs(delta).toFixed(1)}% vs the prior period — run a limited-time "Comeback" promo (e.g. 15% off any drink for 3 days) and post it on social.`);
    else if (delta > 10) out.push(`Sales are up ${delta.toFixed(1)}% — capitalise on the momentum: add a loyalty bonus week (2× points) to lock in returning customers.`);
    else out.push(`Sales are flat vs prior period — try a bundled combo (drink + pastry) at a small discount to lift average order value.`);
  }

  if (top5[0]) {
    out.push(`Best seller "${top5[0].name}" (${top5[0].qty} sold) — feature it as a "Customer Favorite" on signage and offer an upsize upgrade for ₱20.`);
  }
  if (top5[1] && top5[0]?.category !== top5[1]?.category) {
    out.push(`Pair "${top5[0].name}" with "${top5[1].name}" as a combo deal to cross-sell between categories.`);
  }
  const slow = bot5.filter((b) => b.qty > 0).slice(0, 2);
  if (slow.length) {
    out.push(`Slow movers: ${slow.map((s) => `"${s.name}"`).join(", ")} — try a "Buy 1 get 1 50% off" or feature them in a barista's-pick story to clear stock.`);
  }
  const zero = bot5.filter((b) => b.qty === 0);
  if (zero.length) {
    out.push(`${zero.length} item(s) had zero sales — review pricing/positioning or consider rotating off the menu.`);
  }

  if (catTotals.length >= 2) {
    const [topCat, secondCat] = catTotals;
    const ratio = secondCat[1] > 0 ? topCat[1] / secondCat[1] : 99;
    if (ratio > 2) {
      out.push(`${topCat[0]} dominates sales (${(topCat[1] / totals.net * 100).toFixed(0)}% of net). Push ${secondCat[0]} via a "Pair your drink with…" upsell at checkout.`);
    }
  }

  const cashPay = paymentBreakdown.find(([k]) => /cash/i.test(k));
  if (cashPay && cashPay[1] / Math.max(totals.net, 1) > 0.7) {
    out.push(`Cash is ${(cashPay[1] / totals.net * 100).toFixed(0)}% of payments — promote GCash/card with a small loyalty point bonus to reduce cash handling.`);
  }

  if (totals.avg < 150) {
    out.push(`Average order is ${peso(totals.avg)} — train baristas to suggest a pastry add-on; even 30% take-rate at ₱60 lifts AOV meaningfully.`);
  }

  return out.length ? out : ["Performance looks healthy — keep tracking weekly and rotate one feature drink per week to test new favorites."];
}
