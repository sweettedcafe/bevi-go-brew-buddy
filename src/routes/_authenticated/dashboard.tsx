import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart, TrendingUp, TrendingDown, Tag, Package, Users, AlertTriangle,
  ArrowUp, ArrowDown,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const db = supabase as any;
type Period = "day" | "week" | "month" | "year";
type Row = Record<string, any>;

function rangeFor(period: Period, ref = new Date()): { from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string } {
  const to = new Date(ref); to.setHours(23, 59, 59, 999);
  const from = new Date(ref); from.setHours(0, 0, 0, 0);
  let label = "Today";
  if (period === "day") {
    // already set
  } else if (period === "week") {
    from.setDate(from.getDate() - 6); label = "Last 7 days";
  } else if (period === "month") {
    from.setDate(from.getDate() - 29); label = "Last 30 days";
  } else {
    from.setDate(from.getDate() - 364); label = "Last 365 days";
  }
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  return { from, to, prevFrom, prevTo, label };
}

function peso(n: number) { return `₱${Number(n || 0).toFixed(2)}`; }
function pct(curr: number, prev: number) {
  if (!prev) return curr > 0 ? 100 : 0;
  return ((curr - prev) / prev) * 100;
}

async function loadOrders(from: Date, to: Date) {
  const { data } = await db.from("orders")
    .select("id,total,subtotal,discount_total,status,customer_id,customer_name,created_at")
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString());
  return ((data ?? []) as Row[]).filter((o) => o.status !== "voided" && o.status !== "refunded");
}

function Dashboard() {
  const [period, setPeriod] = useState<Period>("day");
  const [loading, setLoading] = useState(true);
  const [curr, setCurr] = useState<Row[]>([]);
  const [prev, setPrev] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [restock, setRestock] = useState<Row[]>([]);

  const r = useMemo(() => rangeFor(period), [period]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [currOrders, prevOrders, restockRows] = await Promise.all([
        loadOrders(r.from, r.to),
        loadOrders(r.prevFrom, r.prevTo),
        db.from("inventory_items")
          .select("id,name,unit,stock_qty,low_threshold")
          .eq("is_active", true)
          .then((res: any) =>
            ((res.data ?? []) as Row[]).filter(
              (i) => Number(i.stock_qty) <= Number(i.low_threshold) && Number(i.low_threshold) > 0,
            ),
          ),
      ]);
      const ids = currOrders.map((o) => o.id);
      let lineItems: Row[] = [];
      if (ids.length) {
        const { data } = await db.from("order_items")
          .select("order_id,qty,line_total,menu_item_id,name_snapshot,menu_items(category_id,categories(name))")
          .in("order_id", ids);
        lineItems = (data ?? []) as Row[];
      }
      if (!alive) return;
      setCurr(currOrders); setPrev(prevOrders); setItems(lineItems); setRestock(restockRows);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [period]);

  const totals = useMemo(() => {
    const sum = (xs: Row[], k: string) => xs.reduce((s, x) => s + Number(x[k] || 0), 0);
    return {
      count: curr.length, prevCount: prev.length,
      gross: sum(curr, "subtotal"), prevGross: sum(prev, "subtotal"),
      net: sum(curr, "total"), prevNet: sum(prev, "total"),
      disc: sum(curr, "discount_total"), prevDisc: sum(prev, "discount_total"),
    };
  }, [curr, prev]);

  const byItem = useMemo(() => {
    const map = new Map<string, { name: string; category: string; qty: number; revenue: number }>();
    for (const it of items) {
      const key = it.menu_item_id ?? it.name_snapshot;
      const cur = map.get(key) ?? {
        name: it.name_snapshot,
        category: it.menu_items?.categories?.name ?? "—",
        qty: 0, revenue: 0,
      };
      cur.qty += Number(it.qty || 0); cur.revenue += Number(it.line_total || 0);
      map.set(key, cur);
    }
    const arr = [...map.values()];
    const top = [...arr].sort((a, b) => b.qty - a.qty).slice(0, 5);
    const bottom = [...arr].sort((a, b) => a.qty - b.qty).slice(0, 5);
    return { top, bottom };
  }, [items]);

  const topCustomers = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; spend: number }>();
    for (const o of curr) {
      const key = o.customer_id ?? o.customer_name ?? "walkin";
      if (!o.customer_id && !o.customer_name) continue; // skip walk-ins
      const cur = map.get(key) ?? { name: o.customer_name ?? "—", orders: 0, spend: 0 };
      cur.orders += 1; cur.spend += Number(o.total || 0);
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.orders - a.orders).slice(0, 5);
  }, [curr]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Dashboard</p>
          <h1 className="text-2xl font-display">Overview · {r.label}</h1>
        </div>
        <div className="ml-auto">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">Last 30 days</SelectItem>
              <SelectItem value="year">Last 365 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Scorecard label="Orders" value={String(totals.count)} delta={pct(totals.count, totals.prevCount)}
          prev={`${totals.prevCount} prev`} icon={ShoppingCart} />
        <Scorecard label="Gross sales" value={peso(totals.gross)} delta={pct(totals.gross, totals.prevGross)}
          prev={`${peso(totals.prevGross)} prev`} icon={TrendingUp} />
        <Scorecard label="Discounts" value={peso(totals.disc)} delta={pct(totals.disc, totals.prevDisc)}
          prev={`${peso(totals.prevDisc)} prev`} icon={Tag} invertColor />
        <Scorecard label="Net sales" value={peso(totals.net)} delta={pct(totals.net, totals.prevNet)}
          prev={`${peso(totals.prevNet)} prev`} icon={TrendingUp} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Top 5 best sellers" icon={TrendingUp}>
          <ItemList rows={byItem.top} empty="No sales in this period." />
        </Panel>
        <Panel title="Bottom 5 sellers" icon={TrendingDown}>
          <ItemList rows={byItem.bottom} empty="No sales in this period." />
        </Panel>

        <Panel title="Top 5 customers" icon={Users}>
          {topCustomers.length === 0 ? (
            <Empty text="No tagged customers in this period." />
          ) : (
            <ul className="divide-y">
              {topCustomers.map((c, i) => (
                <li key={i} className="flex justify-between py-2 text-sm">
                  <span className="truncate">{i + 1}. {c.name}</span>
                  <span className="text-muted-foreground">{c.orders} orders · {peso(c.spend)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Restock needed" icon={AlertTriangle}>
          {restock.length === 0 ? (
            <Empty text="All ingredients above threshold." />
          ) : (
            <ul className="divide-y">
              {restock.slice(0, 10).map((r) => (
                <li key={r.id} className="flex justify-between py-2 text-sm">
                  <span className="truncate flex items-center gap-2">
                    <Package className="h-3 w-3 text-muted-foreground" />{r.name}
                  </span>
                  <span className="text-destructive">
                    {Number(r.stock_qty).toFixed(2)} / {Number(r.low_threshold).toFixed(2)} {r.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {loading && <div className="text-xs text-muted-foreground text-center">Loading…</div>}
    </div>
  );
}

function Scorecard({ label, value, delta, prev, icon: Icon, invertColor }: {
  label: string; value: string; delta: number; prev: string;
  icon: typeof ShoppingCart; invertColor?: boolean;
}) {
  const up = delta >= 0;
  // For discounts, "up" is bad. For everything else, "up" is good.
  const good = invertColor ? !up : up;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="font-display text-2xl mt-1">{value}</div>
      <div className="flex items-center gap-2 mt-2 text-xs">
        <Badge variant={good ? "default" : "destructive"} className="gap-1">
          {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(delta).toFixed(1)}%
        </Badge>
        <span className="text-muted-foreground">vs {prev}</span>
      </div>
    </Card>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: typeof Users; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="font-medium">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function ItemList({ rows, empty }: { rows: { name: string; category: string; qty: number; revenue: number }[]; empty: string }) {
  if (rows.length === 0) return <Empty text={empty} />;
  return (
    <ul className="divide-y">
      {rows.map((r, i) => (
        <li key={i} className="flex justify-between py-2 text-sm">
          <span className="truncate">
            {i + 1}. {r.name}
            <span className="ml-2 text-xs text-muted-foreground">{r.category}</span>
          </span>
          <span className="text-muted-foreground whitespace-nowrap">{r.qty} sold · {peso(r.revenue)}</span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground py-4 text-center">{text}</div>;
}
