import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { BarChart3, Download, Filter, Settings2, RotateCcw, XCircle, Eye, FileSpreadsheet, Tag } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

const db = supabase as any;
type AnyRow = Record<string, any>;

type Filters = {
  from: string; to: string;
  customer: string; orderId: string; cashier: string;
  category: string; item: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const PER_ORDER_COLS = [
  { key: "order_no", label: "Order #" },
  { key: "created_at", label: "Date / time" },
  { key: "customer_name", label: "Customer" },
  { key: "cashier_email", label: "Cashier" },
  { key: "items_count", label: "Items" },
  { key: "subtotal", label: "Subtotal" },
  { key: "discount_total", label: "Discount" },
  { key: "discount_label", label: "Discount label" },
  { key: "payment_label", label: "Payment" },
  { key: "fee_amount", label: "Fee" },
  { key: "total", label: "Total" },
  { key: "status", label: "Status" },
];
const PER_ITEM_COLS = [
  { key: "name", label: "Item" },
  { key: "category", label: "Category" },
  { key: "qty", label: "Qty sold" },
  { key: "revenue", label: "Revenue" },
];
const DISCOUNT_COLS = [
  { key: "order_no", label: "Order #" },
  { key: "created_at", label: "Date" },
  { key: "customer_name", label: "Customer" },
  { key: "discount_label", label: "Promotion / discount" },
  { key: "discount_code", label: "Code" },
  { key: "discount_total", label: "Amount" },
  { key: "total", label: "Order total" },
];

function loadCols(tab: string, defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(`bevi.reports.cols.${tab}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return defaults;
}
function saveCols(tab: string, cols: string[]) {
  localStorage.setItem(`bevi.reports.cols.${tab}`, JSON.stringify(cols));
}

function ReportsPage() {
  const { hasRole } = useAuth();
  const canRefund = hasRole("admin") || hasRole("developer");
  const [filters, setFilters] = useState<Filters>({
    from: daysAgoIso(30), to: todayIso(), customer: "", orderId: "", cashier: "", category: "", item: "",
  });
  const [tab, setTab] = useState("order");
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<AnyRow[]>([]);
  const [staffEmails, setStaffEmails] = useState<Record<string, string>>({});
  const [detailId, setDetailId] = useState<string | null>(null);

  const [colsOrder, setColsOrder] = useState<string[]>(() => loadCols("order", PER_ORDER_COLS.map(c => c.key)));
  const [colsItem, setColsItem] = useState<string[]>(() => loadCols("item", PER_ITEM_COLS.map(c => c.key)));
  const [colsDisc, setColsDisc] = useState<string[]>(() => loadCols("discount", DISCOUNT_COLS.map(c => c.key)));

  useEffect(() => { saveCols("order", colsOrder); }, [colsOrder]);
  useEffect(() => { saveCols("item", colsItem); }, [colsItem]);
  useEffect(() => { saveCols("discount", colsDisc); }, [colsDisc]);

  async function loadAll() {
    setLoading(true);
    const fromTs = `${filters.from}T00:00:00`;
    const toTs   = `${filters.to}T23:59:59`;
    let q = db.from("orders")
      .select("id,order_no,created_at,customer_name,cashier_id,subtotal,discount_total,discount_label,discount_code,total,status,points_earned,points_redeemed,source")
      .gte("created_at", fromTs).lte("created_at", toTs)
      .order("created_at", { ascending: false });
    if (filters.customer.trim()) q = q.ilike("customer_name", `%${filters.customer.trim()}%`);
    if (filters.orderId.trim())  q = q.eq("order_no", Number(filters.orderId.trim()) || -1);

    const [{ data: o }, { data: emails }] = await Promise.all([
      q,
      db.rpc("staff_emails"),
    ]);

    const emailMap: Record<string, string> = {};
    ((emails ?? []) as any[]).forEach((e) => { emailMap[e.user_id] = e.email; });
    setStaffEmails(emailMap);

    let list = ((o ?? []) as AnyRow[]);
    if (filters.cashier.trim()) {
      const needle = filters.cashier.trim().toLowerCase();
      list = list.filter((r) => (emailMap[r.cashier_id] ?? "").toLowerCase().includes(needle));
    }
    const ids = list.map((r) => r.id);
    if (ids.length) {
      const [{ data: items }, { data: pays }, { data: pms }] = await Promise.all([
        db.from("order_items").select("order_id,qty,line_total,menu_item_id,name_snapshot,menu_items(category_id,categories(name))").in("order_id", ids),
        db.from("order_payments").select("order_id,method,method_code,amount,fee_amount,change_due").in("order_id", ids),
        db.from("payment_methods").select("code,label"),
      ]);
      const pmLabel = new Map<string, string>(((pms ?? []) as any[]).map((p) => [p.code, p.label]));
      const itemsByOrder = new Map<string, any[]>();
      ((items ?? []) as any[]).forEach((i) => {
        const a = itemsByOrder.get(i.order_id) ?? []; a.push(i); itemsByOrder.set(i.order_id, a);
      });
      const paysByOrder = new Map<string, any[]>();
      ((pays ?? []) as any[]).forEach((p) => {
        const a = paysByOrder.get(p.order_id) ?? []; a.push(p); paysByOrder.set(p.order_id, a);
      });
      list = list.map((r) => {
        const its = itemsByOrder.get(r.id) ?? [];
        const ps = paysByOrder.get(r.id) ?? [];
        const items_count = its.reduce((s, x) => s + Number(x.qty || 0), 0);
        const fee_amount = ps.reduce((s, x) => s + Number(x.fee_amount || 0), 0);
        const payment_label = ps.map((p) => pmLabel.get(p.method_code) ?? p.method_code ?? p.method).join(", ");
        return { ...r, items_count, fee_amount, payment_label,
          cashier_email: emailMap[r.cashier_id] ?? (r.cashier_id ? "—" : "self-order"),
          _items: its, _payments: ps };
      });
    }
    setOrders(list);
    setLoading(false);
  }

  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, []);

  // Per-item aggregation
  const itemRowsAll = useMemo(() => {
    const map = new Map<string, { name: string; category: string; qty: number; revenue: number }>();
    for (const o of orders) {
      if (o.status === "voided" || o.status === "refunded") continue;
      for (const it of (o._items ?? [])) {
        const key = it.menu_item_id ?? it.name_snapshot;
        const cur = map.get(key) ?? {
          name: it.name_snapshot,
          category: it.menu_items?.categories?.name ?? "—",
          qty: 0, revenue: 0,
        };
        cur.qty += Number(it.qty || 0);
        cur.revenue += Number(it.line_total || 0);
        map.set(key, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty);
  }, [orders]);

  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    itemRowsAll.forEach((r) => r.category && s.add(r.category));
    return [...s].sort();
  }, [itemRowsAll]);

  const itemRows = useMemo(() => {
    const cat = filters.category.trim().toLowerCase();
    const item = filters.item.trim().toLowerCase();
    return itemRowsAll.filter((r) => {
      if (cat && r.category.toLowerCase() !== cat) return false;
      if (item && !r.name.toLowerCase().includes(item)) return false;
      return true;
    });
  }, [itemRowsAll, filters.category, filters.item]);

  const discountRows = useMemo(
    () => orders.filter((o) => Number(o.discount_total) > 0),
    [orders],
  );

  const totals = useMemo(() => {
    let gross = 0, disc = 0, net = 0, count = 0;
    for (const o of orders) {
      if (o.status === "voided" || o.status === "refunded") continue;
      gross += Number(o.subtotal); disc += Number(o.discount_total); net += Number(o.total); count++;
    }
    return { gross, disc, net, count };
  }, [orders]);

  async function refund(id: string) {
    if (!confirm("Refund this order? Inventory will be restored and loyalty points reversed.")) return;
    const { error } = await db.rpc("pos_refund_order", { p_order_id: id });
    if (error) { toast.error(error.message); return; }
    toast.success("Order refunded");
    await loadAll();
  }
  async function voidOrder(id: string) {
    if (!confirm("Void this order? Same as refund: stock restored, points reversed.")) return;
    const { error } = await db.rpc("pos_void_order", { p_order_id: id });
    if (error) { toast.error(error.message); return; }
    toast.success("Order voided");
    await loadAll();
  }

  function exportCurrent() {
    if (tab === "order") {
      const rows = orders.map((o) => Object.fromEntries(PER_ORDER_COLS.map((c) => [c.key, fmt(o[c.key], c.key)])));
      downloadCsv(`per-order-${todayIso()}.csv`, toCsv(rows, PER_ORDER_COLS.map((c) => c.label)));
    } else if (tab === "item") {
      const rows = itemRows.map((r) => Object.fromEntries(PER_ITEM_COLS.map((c) => [c.label, (r as any)[c.key]])));
      downloadCsv(`per-item-${todayIso()}.csv`, toCsv(rows, PER_ITEM_COLS.map((c) => c.label)));
    } else {
      const rows = discountRows.map((o) => Object.fromEntries(DISCOUNT_COLS.map((c) => [c.label, fmt(o[c.key], c.key)])));
      downloadCsv(`discounts-${todayIso()}.csv`, toCsv(rows, DISCOUNT_COLS.map((c) => c.label)));
    }
  }

  function openSheetsImport() {
    toast.info(
      "To auto-sync to Google Sheets, run the Phase 9 SQL then ask Lovable to enable the Google Sheets connector. For now, use Export CSV and import into Sheets via File → Import.",
      { duration: 8000 },
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Reports</h1>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCurrent}>
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={openSheetsImport}>
            <FileSpreadsheet className="h-3 w-3 mr-1" /> Google Sheets
          </Button>
        </div>
      </header>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Filter className="h-4 w-4 text-muted-foreground mb-2" />
          <div><Label className="text-xs">From</Label>
            <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
          <div><Label className="text-xs">To</Label>
            <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
          <div><Label className="text-xs">Customer</Label>
            <Input placeholder="Search name" value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })} /></div>
          <div><Label className="text-xs">Order ID</Label>
            <Input placeholder="#" value={filters.orderId} onChange={(e) => setFilters({ ...filters, orderId: e.target.value })} className="w-24" /></div>
          <div><Label className="text-xs">Cashier email</Label>
            <Input placeholder="@" value={filters.cashier} onChange={(e) => setFilters({ ...filters, cashier: e.target.value })} /></div>
          <div>
            <Label className="text-xs">Category</Label>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            >
              <option value="">All</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><Label className="text-xs">Item name</Label>
            <Input placeholder="Search item" value={filters.item} onChange={(e) => setFilters({ ...filters, item: e.target.value })} /></div>
          <Button size="sm" onClick={loadAll} disabled={loading}>{loading ? "Loading…" : "Apply"}</Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Orders" value={totals.count.toString()} />
        <Stat label="Gross" value={`₱${totals.gross.toFixed(2)}`} />
        <Stat label="Discounts" value={`₱${totals.disc.toFixed(2)}`} />
        <Stat label="Net" value={`₱${totals.net.toFixed(2)}`} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center gap-2">
          <TabsList>
            <TabsTrigger value="order">Per order</TabsTrigger>
            <TabsTrigger value="item">Per item</TabsTrigger>
            <TabsTrigger value="discount">Discounts &amp; promos</TabsTrigger>
          </TabsList>
          <ColumnsPicker
            cols={tab === "order" ? PER_ORDER_COLS : tab === "item" ? PER_ITEM_COLS : DISCOUNT_COLS}
            value={tab === "order" ? colsOrder : tab === "item" ? colsItem : colsDisc}
            onChange={(v) => tab === "order" ? setColsOrder(v) : tab === "item" ? setColsItem(v) : setColsDisc(v)}
          />
        </div>

        <TabsContent value="order">
          <DataTable
            cols={PER_ORDER_COLS.filter((c) => colsOrder.includes(c.key))}
            rows={orders}
            render={(row, key) => {
              if (key === "status") return <StatusBadge s={row.status} />;
              return fmt(row[key], key);
            }}
            actions={(row) => (
              <div className="flex gap-1 justify-end">
                <Button size="icon" variant="ghost" title="View" onClick={() => setDetailId(row.id)}>
                  <Eye className="h-4 w-4" />
                </Button>
                {canRefund && row.status !== "voided" && row.status !== "refunded" && (
                  <>
                    <Button size="icon" variant="ghost" title="Refund" onClick={() => refund(row.id)}>
                      <RotateCcw className="h-4 w-4 text-amber-600" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Void" onClick={() => voidOrder(row.id)}>
                      <XCircle className="h-4 w-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            )}
            empty="No orders match the filters."
          />
        </TabsContent>

        <TabsContent value="item">
          <DataTable
            cols={PER_ITEM_COLS.filter((c) => colsItem.includes(c.key))}
            rows={itemRows}
            render={(row, key) => {
              if (key === "revenue") return `₱${Number(row.revenue).toFixed(2)}`;
              return (row as any)[key];
            }}
            empty="No items sold in this range."
          />
        </TabsContent>

        <TabsContent value="discount">
          <DataTable
            cols={DISCOUNT_COLS.filter((c) => colsDisc.includes(c.key))}
            rows={discountRows}
            render={(row, key) => {
              if (key === "discount_label") return row.discount_label ?? <Tag className="h-3 w-3 inline" />;
              return fmt(row[key], key);
            }}
            empty="No discounted orders in this range."
          />
        </TabsContent>
      </Tabs>

      {detailId && <OrderDetailDialog id={detailId} staffEmails={staffEmails}
        onClose={() => setDetailId(null)} />}
    </div>
  );
}

function fmt(v: any, key: string) {
  if (v == null) return "—";
  if (key === "created_at") return new Date(v).toLocaleString();
  if (key === "subtotal" || key === "discount_total" || key === "total" || key === "fee_amount")
    return `₱${Number(v).toFixed(2)}`;
  if (key === "order_no") return `#${String(v).padStart(3, "0")}`;
  return String(v);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-xl">{value}</div>
    </Card>
  );
}

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    completed: "default", on_hold: "secondary", voided: "destructive", refunded: "outline", open: "secondary",
  };
  return <Badge variant={(map[s] ?? "secondary") as any} className="capitalize">{s.replace("_", " ")}</Badge>;
}

function ColumnsPicker({ cols, value, onChange }: {
  cols: { key: string; label: string }[]; value: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="ml-auto">
          <Settings2 className="h-3 w-3 mr-1" /> Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <div className="space-y-1.5 text-sm">
          {cols.map((c) => (
            <label key={c.key} className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={value.includes(c.key)} onCheckedChange={(ck) => {
                if (ck) onChange([...value, c.key]);
                else onChange(value.filter((k) => k !== c.key));
              }} />
              {c.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DataTable({ cols, rows, render, actions, empty }: {
  cols: { key: string; label: string }[];
  rows: AnyRow[];
  render: (row: AnyRow, key: string) => React.ReactNode;
  actions?: (row: AnyRow) => React.ReactNode;
  empty: string;
}) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground p-6 text-center">{empty}</div>;
  return (
    <div className="overflow-auto border rounded-md mt-2">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide">
          <tr>
            {cols.map((c) => <th key={c.key} className="text-left px-3 py-2 whitespace-nowrap">{c.label}</th>)}
            {actions && <th className="px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i} className="border-t hover:bg-accent/30">
              {cols.map((c) => <td key={c.key} className="px-3 py-2 whitespace-nowrap">{render(row, c.key)}</td>)}
              {actions && <td className="px-3 py-2 text-right">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderDetailDialog({ id, staffEmails, onClose }: {
  id: string; staffEmails: Record<string, string>; onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const [{ data: o }, { data: items }, { data: pays }, { data: pms }] = await Promise.all([
        db.from("orders").select("*").eq("id", id).maybeSingle(),
        db.from("order_items").select("*").eq("order_id", id),
        db.from("order_payments").select("*").eq("order_id", id),
        db.from("payment_methods").select("code,label"),
      ]);
      const pmMap = new Map<string, string>(((pms ?? []) as any[]).map((p) => [p.code, p.label]));
      setData({ o, items: items ?? [], pays: pays ?? [], pmMap });
    })();
  }, [id]);
  if (!data) return null;
  const { o, items, pays, pmMap } = data;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Order #{String(o.order_no).padStart(3, "0")} · <StatusBadge s={o.status} /></DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          {new Date(o.created_at).toLocaleString()} · {o.order_type} ·
          Cashier {staffEmails[o.cashier_id] ?? "self-order"} ·
          Customer {o.customer_name ?? "Walk-in"}
        </div>
        <div className="border rounded-md divide-y">
          {items.map((it: any) => (
            <div key={it.id} className="p-3 text-sm">
              <div className="flex justify-between">
                <div className="font-medium">{it.qty}× {it.name_snapshot}</div>
                <div>₱{Number(it.line_total).toFixed(2)}</div>
              </div>
              {it.customization && (
                <div className="text-xs text-muted-foreground pl-3 mt-0.5">
                  {Array.isArray(it.customization)
                    ? it.customization.map((c: any) => c.label ?? c.name).filter(Boolean).join(" · ")
                    : typeof it.customization === "object"
                      ? Object.entries(it.customization).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")
                      : String(it.customization)}
                </div>
              )}
              {it.notes && <div className="text-xs italic text-muted-foreground pl-3 mt-0.5">“{it.notes}”</div>}
            </div>
          ))}
        </div>
        <div className="text-sm space-y-1">
          <Row k="Subtotal" v={`₱${Number(o.subtotal).toFixed(2)}`} />
          {Number(o.discount_total) > 0 && <Row k={`Discount${o.discount_label ? ` (${o.discount_label})` : ""}`} v={`− ₱${Number(o.discount_total).toFixed(2)}`} />}
          {pays.map((p: any) => (
            <Row key={p.id} k={`${pmMap.get(p.method_code) ?? p.method_code ?? p.method}${Number(p.fee_amount) > 0 ? ` (fee ₱${Number(p.fee_amount).toFixed(2)})` : ""}`}
              v={`₱${Number(p.amount).toFixed(2)}${Number(p.change_due) > 0 ? ` (change ₱${Number(p.change_due).toFixed(2)})` : ""}`} />
          ))}
          <Row k="Total" v={`₱${Number(o.total).toFixed(2)}`} bold />
          {(o.points_earned > 0 || o.points_redeemed > 0) && (
            <div className="text-xs text-muted-foreground">
              {o.points_earned > 0 && `+${o.points_earned} pts earned · `}
              {o.points_redeemed > 0 && `${o.points_redeemed} pts redeemed`}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-display text-base" : ""}`}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}
