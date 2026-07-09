import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Cell, Legend,
} from "recharts";
import { BarChart3, Filter, TrendingUp, TrendingDown, RefreshCw, Radio, Sparkles, Coins, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useRealtime } from "@/lib/use-realtime";

export const Route = createFileRoute("/_authenticated/analytics")({
  ssr: false,
  component: AnalyticsPage,
});

const db = supabase as any;
const PESO = (n: number) => `₱${Number(n || 0).toFixed(2)}`;
const HOURS = ["12am","1","2","3","4","5","6","7","8","9","10","11","12pm","1","2","3","4","5","6","7","8","9","10","11"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

type Analytics = {
  summary: { orders: number; qty: number; revenue: number; tz: string; from: string; to: string };
  by_hour: Array<{ h: number; orders: number; qty: number; revenue: number }>;
  by_weekday: Array<{ d: number; orders: number; qty: number; revenue: number }>;
  by_day: Array<{ day: string; orders: number; qty: number; revenue: number }>;
  by_month: Array<{ month: string; orders: number; qty: number; revenue: number }>;
  top_items: Array<{ menu_item_id: string; name: string; qty: number; revenue: number }>;
};
type Owner = { id: string; name: string };
type Cat = { id: string; name: string };
type Item = { id: string; name: string };

function AnalyticsPage() {
  const { hasRole } = useAuth();
  const canSee = hasRole("admin") || hasRole("developer");
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [ownerId, setOwnerId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [menuItemId, setMenuItemId] = useState<string>("");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [realtime, setRealtime] = useState(true);
  const [expVsSales, setExpVsSales] = useState<{ days: Array<{ day: string; sales: number; expenses: number }>; totals: { sales: number; expenses: number } } | null>(null);
  const [upsell, setUpsell] = useState<{
    barista: { orders: number; yes: number; no: number };
    customer: { orders: number; yes: number; no: number };
    per_barista: Array<{ user_id: string; email: string; orders: number; yes: number; no: number }>;
  } | null>(null);
  const [showBaristaDetail, setShowBaristaDetail] = useState(false);
  const [showSkipDetail, setShowSkipDetail] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: o }, { data: c }, { data: m }] = await Promise.all([
        db.from("owners").select("id,name").order("name"),
        db.from("categories").select("id,name").eq("is_active", true).order("sort_order"),
        db.from("menu_items").select("id,name").eq("is_active", true).order("name"),
      ]);
      setOwners((o ?? []) as Owner[]);
      setCats((c ?? []) as Cat[]);
      setItems((m ?? []) as Item[]);
    })();
  }, []);

  async function load() {
    if (!canSee) return;
    setLoading(true);
    const startIso = new Date(`${from}T00:00:00`).toISOString();
    const endIso = new Date(`${to}T23:59:59`).toISOString();
    const [{ data, error }, exp, ordersRes, emailsRes] = await Promise.all([
      db.rpc("pos_analytics", {
        p_from: from, p_to: to,
        p_owner_id: ownerId || null,
        p_category_id: categoryId || null,
        p_menu_item_id: menuItemId || null,
      }),
      db.rpc("admin_list_expenses", { p_from: startIso, p_to: endIso }),
      db.from("orders")
        .select("id,cashier_id,source,status,txn_kind,order_items(is_upsell)")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
      db.rpc("staff_emails"),
    ]);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setData(data as Analytics);
    if (!exp.error) {
      // Build daily series and totals directly from the same list the
      // Expenses Report uses, so figures match reliably.
      const list = (exp.data ?? []) as Array<{ created_at: string; amount: number }>;
      const byDay = new Map<string, number>();
      let totalExp = 0;
      for (const r of list) {
        const amt = Number(r.amount || 0);
        totalExp += amt;
        const day = new Date(r.created_at).toISOString().slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + amt);
      }
      setExpVsSales({
        days: [...byDay.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([day, expenses]) => ({ day, sales: 0, expenses })),
        totals: { sales: 0, expenses: totalExp },
      });
    }
    // Compute upsell stats from per-item flags so numbers match Reports > Per Item.
    // Rate = (yes items / total orders) * 100. Skip = (no items / total orders) * 100.
    if (!ordersRes.error) {
      const emailMap: Record<string, string> = {};
      ((emailsRes?.data ?? []) as any[]).forEach((e) => { emailMap[e.user_id] = e.email; });
      const ordersList = ((ordersRes.data ?? []) as any[]).filter(
        (o) => (o.txn_kind ?? "sale") === "sale" && o.status !== "voided" && o.status !== "refunded",
      );
      const bar = { orders: 0, yes: 0, no: 0 };
      const cust = { orders: 0, yes: 0, no: 0 };
      const perBar = new Map<string, { user_id: string; email: string; orders: number; yes: number; no: number }>();
      for (const o of ordersList) {
        const items = (o.order_items ?? []) as Array<{ is_upsell: boolean }>;
        const yes = items.reduce((s, it) => s + (it.is_upsell ? 1 : 0), 0);
        const no = items.length - yes;
        if (o.source === "self") {
          cust.orders += 1; cust.yes += yes; cust.no += no;
        } else {
          bar.orders += 1; bar.yes += yes; bar.no += no;
          if (o.cashier_id) {
            const cur = perBar.get(o.cashier_id) ?? {
              user_id: o.cashier_id, email: emailMap[o.cashier_id] ?? o.cashier_id, orders: 0, yes: 0, no: 0,
            };
            cur.orders += 1; cur.yes += yes; cur.no += no;
            perBar.set(o.cashier_id, cur);
          }
        }
      }
      setUpsell({
        barista: bar,
        customer: cust,
        per_barista: [...perBar.values()].sort((a, b) => b.orders - a.orders),
      });
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  useRealtime(realtime ? ["orders", "order_items"] : [], () => {
    void load();
  }, [realtime, from, to, ownerId, categoryId, menuItemId]);

  const hourSeries = useMemo(() => {
    const m = new Map<number, { h: number; label: string; orders: number; qty: number; revenue: number }>();
    for (let h = 0; h < 24; h++) m.set(h, { h, label: HOURS[h], orders: 0, qty: 0, revenue: 0 });
    for (const r of (data?.by_hour ?? [])) {
      const o = m.get(r.h) ?? { h: r.h, label: HOURS[r.h] ?? String(r.h), orders: 0, qty: 0, revenue: 0 };
      m.set(r.h, { ...o, orders: r.orders, qty: Number(r.qty), revenue: Number(r.revenue) });
    }
    return [...m.values()];
  }, [data]);

  const weekdaySeries = useMemo(() => {
    const m = new Map<number, { d: number; label: string; orders: number; qty: number; revenue: number }>();
    for (let d = 0; d < 7; d++) m.set(d, { d, label: WEEKDAYS[d], orders: 0, qty: 0, revenue: 0 });
    for (const r of (data?.by_weekday ?? [])) {
      m.set(r.d, { d: r.d, label: WEEKDAYS[r.d], orders: r.orders, qty: Number(r.qty), revenue: Number(r.revenue) });
    }
    return [...m.values()];
  }, [data]);

  const daySeries = useMemo(() => (data?.by_day ?? []).map((r) => ({
    label: r.day, orders: r.orders, qty: Number(r.qty), revenue: Number(r.revenue),
  })), [data]);

  const monthSeries = useMemo(() => (data?.by_month ?? []).map((r) => ({
    label: r.month, orders: r.orders, qty: Number(r.qty), revenue: Number(r.revenue),
  })), [data]);

  const peakHour = useMemo(() => {
    let best = hourSeries[0]; for (const r of hourSeries) if (r.orders > (best?.orders ?? -1)) best = r;
    return best;
  }, [hourSeries]);
  const leastHour = useMemo(() => {
    const nonZero = hourSeries.filter((r) => r.orders > 0);
    if (nonZero.length === 0) return null;
    let worst = nonZero[0]; for (const r of nonZero) if (r.orders < worst.orders) worst = r;
    return worst;
  }, [hourSeries]);
  const peakDay = useMemo(() => {
    let best = weekdaySeries[0]; for (const r of weekdaySeries) if (r.orders > (best?.orders ?? -1)) best = r;
    return best;
  }, [weekdaySeries]);
  const leastDay = useMemo(() => {
    const nz = weekdaySeries.filter((r) => r.orders > 0);
    if (nz.length === 0) return null;
    let w = nz[0]; for (const r of nz) if (r.orders < w.orders) w = r;
    return w;
  }, [weekdaySeries]);

  if (!canSee) return <div className="p-10 text-muted-foreground">Admins only.</div>;

  const maxHour = Math.max(1, ...hourSeries.map((h) => h.orders));

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Analytics</h1>
        <Badge variant="outline" className="text-[10px]">Asia/Manila</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant={realtime ? "default" : "outline"}
            onClick={() => setRealtime((v) => !v)}>
            <Radio className="h-3 w-3 mr-1" /> Live {realtime ? "on" : "off"}
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Filter className="h-4 w-4 text-muted-foreground mb-2" />
          <div><Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="min-w-[150px]">
            <Label className="text-xs">Owner</Label>
            <Select value={ownerId || "__all__"} onValueChange={(v) => setOwnerId(v === "__all__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All owners</SelectItem>
                {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[150px]">
            <Label className="text-xs">Category</Label>
            <Select value={categoryId || "__all__"} onValueChange={(v) => setCategoryId(v === "__all__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All categories</SelectItem>
                {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Item</Label>
            <Select value={menuItemId || "__all__"} onValueChange={(v) => setMenuItemId(v === "__all__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All items</SelectItem>
                {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={load} disabled={loading}>{loading ? "Loading…" : "Apply"}</Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat label="Orders" value={String(data?.summary.orders ?? 0)} />
        <Stat label="Items sold" value={String(Number(data?.summary.qty ?? 0))} />
        <Stat label="Revenue" value={PESO(Number(data?.summary.revenue ?? 0))} />
        <Stat label="Expenses" value={PESO(Number(expVsSales?.totals.expenses ?? 0))} />
        <Stat
          label="Net (Rev − Exp)"
          value={PESO(Number(data?.summary.revenue ?? 0) - Number(expVsSales?.totals.expenses ?? 0))}
        />
        <Stat label="Avg / order"
          value={PESO((data?.summary.orders ?? 0) > 0
            ? Number(data!.summary.revenue) / Number(data!.summary.orders) : 0)} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <div className="font-medium text-sm">Peak hour</div>
            {peakHour && peakHour.orders > 0 && (
              <Badge>{peakHour.label} · {peakHour.orders} orders</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <div className="font-medium text-sm text-muted-foreground">Slowest hour</div>
            {leastHour && <Badge variant="outline">{leastHour.label} · {leastHour.orders} orders</Badge>}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourSeries}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
                {hourSeries.map((d, i) => (
                  <Cell key={i}
                    fill={d.orders === maxHour && d.orders > 0
                      ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.5)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <div className="font-medium text-sm">Busiest day of week</div>
            {peakDay && peakDay.orders > 0 && (
              <Badge>{peakDay.label} · {peakDay.orders} orders</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <div className="font-medium text-sm text-muted-foreground">Quietest day</div>
            {leastDay && <Badge variant="outline">{leastDay.label} · {leastDay.orders} orders</Badge>}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekdaySeries}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="orders" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="font-medium text-sm">Daily revenue trend</div>
          <span className="text-xs text-muted-foreground">Revenue vs Expenses over time</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={(() => {
            const map = new Map<string, { label: string; revenue: number; expenses: number }>();
            for (const r of daySeries) map.set(r.label, { label: r.label, revenue: Number(r.revenue), expenses: 0 });
            for (const d of (expVsSales?.days ?? [])) {
              const cur = map.get(d.day) ?? { label: d.day, revenue: 0, expenses: 0 };
              cur.expenses = Number(d.expenses);
              if (!map.has(d.day)) cur.revenue = Number(d.sales);
              map.set(d.day, cur);
            }
            return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
          })()}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: any) => PESO(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />

          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="font-medium text-sm mb-2">Monthly revenue</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthSeries}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: any) => PESO(Number(v))} />
              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-3">
          <div className="font-medium text-sm mb-2">Top items in range</div>
          <div className="space-y-1 text-sm">
            {(data?.top_items ?? []).length === 0 && (
              <div className="text-muted-foreground text-xs">No data.</div>
            )}
            {(data?.top_items ?? []).map((t, i) => (
              <div key={t.menu_item_id} className="flex items-center gap-2 border-b last:border-0 py-1">
                <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                <span className="flex-1 truncate">{t.name}</span>
                <Badge variant="outline">{Number(t.qty)} sold</Badge>
                <span className="text-primary font-medium w-20 text-right">{PESO(Number(t.revenue))}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>


      {/* Upsell + Skip rates */}
      <Card className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="font-medium text-sm">Upsell performance</div>
        </div>
        {!upsell ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <UpsellSourceCard title="Cashier upsell rate" stat={upsell.barista} accent="primary" />
              <UpsellSourceCard title="Customer upsell rate" stat={upsell.customer} accent="primary" />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowBaristaDetail((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {showBaristaDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Detailed view — Cashier upsell rate
              </button>
              {showBaristaDetail && (
                <div className="mt-2 border rounded-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs">
                      <tr>
                        <th className="text-left p-2">Cashier</th>
                        <th className="text-right p-2">Upsell rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upsell.per_barista.length === 0 && (
                        <tr><td colSpan={2} className="p-3 text-xs text-muted-foreground text-center">No cashier upsell events in range.</td></tr>
                      )}
                      {upsell.per_barista.map((r) => {
                        const rate = r.orders > 0 ? (r.yes / r.orders) * 100 : 0;
                        return (
                          <tr key={r.user_id} className="border-t">
                            <td className="p-2">{r.email}</td>
                            <td className="p-2 text-right font-medium text-primary">{rate.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="border-t pt-3">
              <div className="font-medium text-sm mb-2">Skip rate</div>
              <div className="grid md:grid-cols-2 gap-3">
                <UpsellSourceCard title="Cashier skip rate" stat={upsell.barista} accent="destructive" showSkip />
                <UpsellSourceCard title="Customer skip rate" stat={upsell.customer} accent="destructive" showSkip />
              </div>

              <button
                type="button"
                onClick={() => setShowSkipDetail((v) => !v)}
                className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {showSkipDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Detailed view — Cashier skip rate
              </button>
              {showSkipDetail && (
                <div className="mt-2 border rounded-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs">
                      <tr>
                        <th className="text-left p-2">Cashier</th>
                        <th className="text-right p-2">Skip rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upsell.per_barista.length === 0 && (
                        <tr><td colSpan={2} className="p-3 text-xs text-muted-foreground text-center">No cashier upsell events in range.</td></tr>
                      )}
                      {upsell.per_barista.map((r) => {
                        const rate = r.orders > 0 ? (r.no / r.orders) * 100 : 0;
                        return (
                          <tr key={r.user_id} className="border-t">
                            <td className="p-2">{r.email}</td>
                            <td className="p-2 text-right font-medium text-destructive">{rate.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function UpsellSourceCard({
  title, stat, accent, showSkip,
}: {
  title: string;
  stat: { offers: number; added: number; skipped: number };
  accent: "primary" | "destructive";
  showSkip?: boolean;
}) {
  const num = showSkip ? stat.skipped : stat.added;
  const rate = stat.offers > 0 ? (num / stat.offers) * 100 : 0;
  const color = accent === "destructive" ? "text-destructive" : "text-primary";
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className={`font-display text-2xl mt-1 ${color}`}>{rate.toFixed(1)}%</div>
      <div className="text-[11px] text-muted-foreground mt-1">
        {num} {showSkip ? "skipped" : "added"} of {stat.offers} offers
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-display text-2xl text-primary mt-1">{value}</div>
    </Card>
  );
}
