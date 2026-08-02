import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { BarChart3, Download, Filter, Settings2, RotateCcw, XCircle, Eye, FileSpreadsheet, Tag, Upload, X } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { useServerFn } from "@tanstack/react-start";
import { exportToGoogleSheets } from "@/lib/sheets.functions";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

const db = supabase as any;
type AnyRow = Record<string, any>;

type Filters = {
  from: string; to: string;
  customer: string; orderId: string; cashier: string;
  category: string; item: string; owner: string; status: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const shortId = (id?: string | null) => (id ? String(id).slice(0, 8) : "—");

const PER_ORDER_COLS = [
  { key: "order_no", label: "Order #" },
  { key: "order_id_short", label: "Order ID" },
  { key: "date_only", label: "Date" },
  { key: "time_only", label: "Time" },
  { key: "txn_kind", label: "Type" },
  { key: "customer_name", label: "Customer" },
  { key: "owners", label: "Owner" },
  { key: "cashier_email", label: "Cashier" },
  { key: "items_count", label: "Items" },
  { key: "subtotal", label: "Subtotal" },
  { key: "discount_total", label: "Discount" },
  { key: "discount_label", label: "Discount label" },
  { key: "payment_label", label: "Payment" },
  { key: "fee_amount", label: "Fee" },
  { key: "total", label: "Total" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Special instructions" },
];
const PER_ITEM_COLS = [
  { key: "order_no", label: "Order #" },
  { key: "order_id_short", label: "Order ID" },
  { key: "date_only", label: "Date" },
  { key: "time_only", label: "Time" },
  { key: "txn_kind", label: "Type" },
  { key: "name", label: "Item" },
  { key: "variant", label: "Variant" },
  { key: "extras", label: "Extras" },
  { key: "flavors", label: "Flavors" },
  { key: "other", label: "Other" },
  { key: "instructions", label: "Special instructions" },
  { key: "category", label: "Category" },
  { key: "owner", label: "Owner" },
  { key: "cashier_email", label: "Cashier" },
  { key: "placed_by", label: "Placed by" },
  { key: "upsell", label: "Upsell" },
  { key: "status", label: "Status" },
  { key: "qty", label: "Qty" },
  { key: "unit_price", label: "Unit price" },
  { key: "addon_total", label: "Add-ons" },
  { key: "revenue", label: "Revenue" },
];

const DISCOUNT_COLS = [
  { key: "order_no", label: "Order #" },
  { key: "order_id_short", label: "Order ID" },
  { key: "date_only", label: "Date" },
  { key: "time_only", label: "Time" },
  { key: "customer_name", label: "Customer" },
  { key: "discount_label", label: "Promotion / discount" },
  { key: "discount_code", label: "Code" },
  { key: "discount_total", label: "Amount" },
  { key: "total", label: "Order total" },
];

function loadCols(tab: string, defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(`bevi.reports.cols.v2.${tab}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return defaults;
}
function saveCols(tab: string, cols: string[]) {
  localStorage.setItem(`bevi.reports.cols.v2.${tab}`, JSON.stringify(cols));
}

function ReportsPage() {
  const { hasRole } = useAuth();
  const canRefund = hasRole("admin") || hasRole("developer");
  const [filters, setFilters] = useState<Filters>({
    from: daysAgoIso(30), to: todayIso(), customer: "", orderId: "", cashier: "", category: "", item: "", owner: "", status: "",
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
      .select("id,order_no,created_at,customer_name,cashier_id,subtotal,discount_total,discount_label,discount_code,total,status,points_earned,points_redeemed,source,txn_kind,parent_order_id,order_type,business_date,notes")
      .gte("created_at", fromTs).lte("created_at", toTs)
      .order("created_at", { ascending: false });
    if (filters.customer.trim()) q = q.ilike("customer_name", `%${filters.customer.trim()}%`);
    // Order ID filter: matches by order number (e.g. "3", "#003") OR by UUID prefix
    const oid = filters.orderId.trim().replace(/^#/, "");
    if (oid) {
      const asNum = Number(oid);
      if (Number.isFinite(asNum) && /^\d+$/.test(oid)) {
        q = q.eq("order_no", asNum);
      } else {
        // UUID or partial UUID: match prefix on id
        q = q.ilike("id", `${oid}%`);
      }
    }

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
        db.from("order_items").select("id,order_id,qty,unit_price,addon_total,line_total,menu_item_id,name_snapshot,is_upsell,notes,customization,variant_id,menu_item_variants(name),menu_items(category_id,owner_id,categories(name),owners(name))").in("order_id", ids),
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
        const ownerNames = [...new Set(its.map((x: any) => x.menu_items?.owners?.name).filter(Boolean))] as string[];
        return { ...r, items_count, fee_amount, payment_label,
          order_id_short: shortId(r.id),
          owners: ownerNames.join(", ") || "—",
          _owners: ownerNames,
          cashier_email: emailMap[r.cashier_id] ?? (r.cashier_id ? "—" : "self-order"),
          _items: its, _payments: ps };
      });
    }
    setOrders(list);
    setLoading(false);
  }

  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, []);

  // Per-item rows: one row per order_item line, with order context
  const itemRowsAll = useMemo(() => {
    const rows: AnyRow[] = [];
    for (const o of orders) {
      const placedByCustomer = o.source === "self";
      const cashierEmail = placedByCustomer ? "self-order" : (staffEmails[o.cashier_id] ?? "—");
      for (const it of (o._items ?? [])) {
        const c = (it.customization ?? null) as any;
        const listOf = (arr: any): string =>
          Array.isArray(arr) ? arr.map((x: any) => x?.label).filter(Boolean).join(", ") : "";
        const groups = c?.groups && typeof c.groups === "object"
          ? Object.entries(c.groups as Record<string, any[]>)
              .map(([g, v]) => `${g}: ${listOf(v)}`)
              .filter((s) => !s.endsWith(": "))
              .join(" | ")
          : "";
        const other = [listOf(c?.others), listOf(c?.other), groups, c?.milk?.label ?? ""]
          .filter(Boolean).join(" | ");
        rows.push({
          id: it.id,
          order_id: o.id,
          order_id_short: shortId(o.id),
          order_no: o.order_no,
          created_at: o.created_at,
          txn_kind: o.txn_kind ?? "sale",
          status: o.status,
          name: it.name_snapshot,
          variant: it.menu_item_variants?.name ?? c?.size?.label ?? "—",
          extras: listOf(c?.extras) || "—",
          flavors: listOf(c?.flavors) || "—",
          other: other || "—",
          instructions: it.notes ?? "—",
          category: it.menu_items?.categories?.name ?? "—",
          owner: it.menu_items?.owners?.name ?? "—",
          cashier_email: cashierEmail,
          placed_by: placedByCustomer ? "Customer" : "Cashier",
          upsell: it.is_upsell ? "Yes" : "No",
          qty: Number(it.qty || 0),
          unit_price: Number(it.unit_price || 0),
          addon_total: Number(it.addon_total || 0),
          revenue: Number(it.line_total || 0),
        });
      }
    }
    return rows;
  }, [orders, staffEmails]);

  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    itemRowsAll.forEach((r) => r.category && r.category !== "—" && s.add(r.category));
    return [...s].sort();
  }, [itemRowsAll]);

  const ownerOptions = useMemo(() => {
    const s = new Set<string>();
    itemRowsAll.forEach((r) => r.owner && r.owner !== "—" && s.add(r.owner));
    return [...s].sort();
  }, [itemRowsAll]);

  const statusOf = (o: AnyRow) => {
    const k = o.txn_kind ?? "sale";
    if (k === "void") return "voided";
    if (k === "refund") return "refunded";
    return o.status;
  };

  const filteredOrders = useMemo(() => {
    const owner = filters.owner.trim().toLowerCase();
    return orders.filter((o) => {
      if (filters.status && statusOf(o) !== filters.status) return false;
      if (owner && !((o._owners ?? []) as string[]).some((n) => n.toLowerCase() === owner)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, filters.status, filters.owner]);

  const itemRows = useMemo(() => {
    const cat = filters.category.trim().toLowerCase();
    const item = filters.item.trim().toLowerCase();
    const owner = filters.owner.trim().toLowerCase();
    const st = filters.status;
    return itemRowsAll.filter((r) => {
      if (cat && r.category.toLowerCase() !== cat) return false;
      if (owner && r.owner.toLowerCase() !== owner) return false;
      if (item && !r.name.toLowerCase().includes(item)) return false;
      if (st) {
        const eff = r.txn_kind === "void" ? "voided" : r.txn_kind === "refund" ? "refunded" : r.status;
        if (eff !== st) return false;
      }
      return true;
    });
  }, [itemRowsAll, filters.category, filters.item, filters.owner, filters.status]);

  const ownerSubtotals = useMemo(() => {
    const m = new Map<string, { qty: number; revenue: number }>();
    for (const r of itemRows) {
      const cur = m.get(r.owner) ?? { qty: 0, revenue: 0 };
      cur.qty += Number(r.qty); cur.revenue += Number(r.revenue);
      m.set(r.owner, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  }, [itemRows]);

  const discountRows = useMemo(
    () => filteredOrders.filter((o) => Number(o.discount_total) > 0),
    [filteredOrders],
  );

  const totals = useMemo(() => {
    const owner = filters.owner.trim().toLowerCase();
    let gross = 0, disc = 0, net = 0, count = 0, held = 0, heldCount = 0;
    for (const o of filteredOrders) {
      const st = statusOf(o);
      const ownerRevenue = owner
        ? ((o._items ?? []) as any[])
            .filter((it) => (it.menu_items?.owners?.name ?? "").toLowerCase() === owner)
            .reduce((s, it) => s + Number(it.line_total || 0), 0)
        : 0;
      if (st === "on_hold" || st === "open") {
        held += owner ? ownerRevenue : Number(o.total || 0); heldCount++;
        continue; // unpaid — never part of gross/net
      }
      // Signed totals: completed sales are positive, void/refund mirrors negative.
      if (owner) {
        gross += ownerRevenue; net += ownerRevenue;
      } else {
        gross += Number(o.subtotal); disc += Number(o.discount_total); net += Number(o.total);
      }
      if ((o.txn_kind ?? "sale") === "sale" && st !== "voided" && st !== "refunded") count++;
    }
    return { gross, disc, net, count, held, heldCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOrders, filters.owner]);


  async function refund(id: string) {
    if (!confirm("Refund this order? A mirror negative transaction will be created and stock restored.")) return;
    const { error } = await db.rpc("pos_refund_order_v2", { p_order_id: id, p_reason: null });
    if (error) { toast.error(error.message); return; }
    toast.success("Order refunded");
    await loadAll();
  }
  async function voidOrder(id: string) {
    if (!confirm("Void this order? A mirror negative transaction will be created and stock restored.")) return;
    const { error } = await db.rpc("pos_void_order_v2", { p_order_id: id, p_reason: null });
    if (error) { toast.error(error.message); return; }
    toast.success("Order voided");
    await loadAll();
  }

  function exportCurrent() {
    if (tab === "order") {
      const rows = filteredOrders.map((o) => Object.fromEntries(PER_ORDER_COLS.map((c) => [c.key, fmt(o[c.key], c.key, o)])));
      downloadCsv(`per-order-${todayIso()}.csv`, toCsv(rows, PER_ORDER_COLS.map((c) => c.label)));
    } else if (tab === "item") {
      const rows = itemRows.map((r) => Object.fromEntries(PER_ITEM_COLS.map((c) => [c.label, (r as any)[c.key]])));
      downloadCsv(`per-item-${todayIso()}.csv`, toCsv(rows, PER_ITEM_COLS.map((c) => c.label)));
    } else {
      const rows = discountRows.map((o) => Object.fromEntries(DISCOUNT_COLS.map((c) => [c.label, fmt(o[c.key], c.key, o)])));
      downloadCsv(`discounts-${todayIso()}.csv`, toCsv(rows, DISCOUNT_COLS.map((c) => c.label)));
    }
  }

  // ---- CSV import: load an external sheet to review / reconcile in-app ----
  const fileRef = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<{ headers: string[]; rows: string[][] } | null>(null);

  function parseCsv(text: string): { headers: string[]; rows: string[][] } {
    const out: string[][] = [];
    let row: string[] = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
      else if (ch !== "\r") cell += ch;
    }
    if (cell.length > 0 || row.length > 0) { row.push(cell); out.push(row); }
    const clean = out.filter((r) => r.some((c) => c.trim() !== ""));
    const headers = clean.shift() ?? [];
    return { headers, rows: clean };
  }

  async function onImportFile(f: File | null) {
    if (!f) return;
    try {
      const parsed = parseCsv(await f.text());
      if (parsed.headers.length === 0) { toast.error("That file has no columns"); return; }
      setImported(parsed);
      toast.success(`Imported ${parsed.rows.length} rows from ${f.name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read that CSV");
    }
  }

  const exportSheets = useServerFn(exportToGoogleSheets);
  const [sheetsBusy, setSheetsBusy] = useState(false);
  async function openSheetsImport() {
    setSheetsBusy(true);
    try {
      const perOrder = {
        title: "Per order",
        headers: PER_ORDER_COLS.map((c) => c.label),
        rows: filteredOrders.map((o) => PER_ORDER_COLS.map((c) => String(fmt(o[c.key], c.key, o)))),
      };
      const perItem = {
        title: "Per item",
        headers: PER_ITEM_COLS.map((c) => c.label),
        rows: itemRows.map((r) => PER_ITEM_COLS.map((c) => {
          const v = (r as any)[c.key];
          if (c.key === "revenue") return Number(v).toFixed(2);
          if (c.key === "created_at") return new Date((r as any).created_at).toLocaleString();
          if (c.key === "date_only") return (r as any).created_at ? new Date((r as any).created_at).toLocaleDateString() : "";
          if (c.key === "time_only") return (r as any).created_at ? new Date((r as any).created_at).toLocaleTimeString() : "";
          if (c.key === "order_no") return `#${String(v).padStart(3, "0")}`;
          return v == null ? "" : String(v);
        })),
      };
      const discounts = {
        title: "Discounts",
        headers: DISCOUNT_COLS.map((c) => c.label),
        rows: discountRows.map((o) => DISCOUNT_COLS.map((c) => String(fmt(o[c.key], c.key, o)))),
      };
      const res = await exportSheets({
        data: {
          title: `Bevi & Go Reports ${todayIso()}`,
          sheets: [perOrder, perItem, discounts],
        },
      });
      toast.success(
        res.shared
          ? "Exported to Google Sheets — anyone with the link can edit"
          : "Exported to Google Sheets (sharing not enabled on the connection)",
        {
          description: "Use Download to save an Excel copy.",
          action: { label: "Open", onClick: () => window.open(res.url, "_blank") },
          cancel: {
            label: "Download",
            onClick: () => window.open(res.downloadXlsx, "_blank"),
          },
          duration: 15000,
        },
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Google Sheets export failed");
    } finally {
      setSheetsBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Reports</h1>
        <div className="ml-auto flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { void onImportFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3 w-3 mr-1" /> Import CSV
          </Button>
          <Button size="sm" variant="outline" onClick={exportCurrent}>
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={openSheetsImport} disabled={sheetsBusy}>
            <FileSpreadsheet className="h-3 w-3 mr-1" /> {sheetsBusy ? "Exporting…" : "Google Sheets"}
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
          <div><Label className="text-xs">Order # or ID</Label>
            <Input placeholder="#003 or UUID prefix" value={filters.orderId} onChange={(e) => setFilters({ ...filters, orderId: e.target.value })} className="w-44" /></div>
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
          <div>
            <Label className="text-xs">Owner</Label>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={filters.owner}
              onChange={(e) => setFilters({ ...filters, owner: e.target.value })}
            >
              <option value="">All</option>
              {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All</option>
              <option value="completed">Completed</option>
              <option value="on_hold">On hold</option>
              <option value="voided">Voided</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
          <div><Label className="text-xs">Item name</Label>
            <Input placeholder="Search item" value={filters.item} onChange={(e) => setFilters({ ...filters, item: e.target.value })} /></div>
          <Button size="sm" onClick={loadAll} disabled={loading}>{loading ? "Loading…" : "Apply"}</Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Orders" value={totals.count.toString()} />
        <Stat label="Gross" value={`₱${totals.gross.toFixed(2)}`} />
        <Stat label="Discounts" value={`₱${totals.disc.toFixed(2)}`} />
        <Stat label="Net (completed)" value={`₱${totals.net.toFixed(2)}`} />
        <Stat label={`On hold (${totals.heldCount})`} value={`₱${totals.held.toFixed(2)}`} />
      </div>


      {imported && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Imported CSV ({imported.rows.length} rows)</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setImported(null)}>
              <X className="h-3 w-3 mr-1" /> Close
            </Button>
          </div>
          <div className="overflow-auto max-h-80 rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>{imported.headers.map((h, i) => <th key={i} className="text-left px-2 py-1 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {imported.rows.slice(0, 500).map((r, i) => (
                  <tr key={i} className="border-t">
                    {imported.headers.map((_, j) => <td key={j} className="px-2 py-1 whitespace-nowrap">{r[j] ?? ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
            rows={filteredOrders}
            render={(row, key) => {
              if (key === "status") return <StatusBadge s={row.status} k={row.txn_kind ?? "sale"} />;
              if (key === "txn_kind") return <TxnBadge k={row.txn_kind ?? "sale"} />;
              if (key === "total" || key === "subtotal" || key === "discount_total") {
                const n = Number(row[key]);
                return <span className={n < 0 ? "text-destructive" : ""}>{`₱${n.toFixed(2)}`}</span>;
              }
              return fmt(row[key], key, row);
            }}
            actions={(row) => {
              const isSale = (row.txn_kind ?? "sale") === "sale";
              return (
                <div className="flex gap-1 justify-end">
                  <Button size="icon" variant="ghost" title="View" onClick={() => setDetailId(row.id)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  {canRefund && isSale && row.status !== "voided" && row.status !== "refunded" && (
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
              );
            }}
            empty="No orders match the filters."
          />
        </TabsContent>

        <TabsContent value="item">
          {ownerSubtotals.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {ownerSubtotals.map(([owner, t]) => (
                <Badge key={owner} variant="outline" className="text-xs">
                  {owner}: {t.qty} units · ₱{t.revenue.toFixed(2)}
                </Badge>
              ))}
            </div>
          )}
          <DataTable
            cols={PER_ITEM_COLS.filter((c) => colsItem.includes(c.key))}
            rows={itemRows}
            render={(row, key) => {
              if (key === "revenue") {
                const n = Number(row.revenue);
                return <span className={n < 0 ? "text-destructive" : ""}>₱{n.toFixed(2)}</span>;
              }
              if (key === "qty") {
                const n = Number(row.qty);
                return <span className={n < 0 ? "text-destructive" : ""}>{n}</span>;
              }
              if (key === "txn_kind") return <TxnBadge k={row.txn_kind ?? "sale"} />;
              if (key === "created_at") return new Date(row.created_at).toLocaleString();
              if (key === "date_only") return row.created_at ? new Date(row.created_at).toLocaleDateString() : "—";
              if (key === "time_only") return row.created_at ? new Date(row.created_at).toLocaleTimeString() : "—";
              if (key === "order_no") return `#${String(row.order_no).padStart(3, "0")}`;
              if (key === "order_id_short") return <span className="font-mono text-xs">{row.order_id_short}</span>;
              if (key === "placed_by") return (
                <Badge variant={row.placed_by === "Customer" ? "default" : "secondary"} className="text-[10px]">
                  {row.placed_by}
                </Badge>
              );
              if (key === "upsell") return (
                <Badge variant={row.upsell === "Yes" ? "default" : "outline"} className="text-[10px]">
                  {row.upsell}
                </Badge>
              );
              return (row as any)[key];
            }}
            actions={(row) => (
              <div className="flex gap-1 justify-end">
                <Button size="icon" variant="ghost" title="View order" onClick={() => setDetailId(row.order_id)}>
                  <Eye className="h-4 w-4" />
                </Button>
              </div>
            )}
            empty="No items sold in this range."
          />
        </TabsContent>

        <TabsContent value="discount">
          <DataTable
            cols={DISCOUNT_COLS.filter((c) => colsDisc.includes(c.key))}
            rows={discountRows}
            render={(row, key) => {
              if (key === "discount_label") return row.discount_label ?? <Tag className="h-3 w-3 inline" />;
              return fmt(row[key], key, row);
            }}
            empty="No discounted orders in this range."
          />
        </TabsContent>
      </Tabs>

      {detailId && (
        <OrderDetailSheet
          orderId={detailId}
          canReverse={canRefund}
          onClose={() => setDetailId(null)}
          onChanged={loadAll}
        />
      )}
    </div>
  );
}

function fmt(v: any, key: string, row?: any) {
  if (key === "date_only") {
    const iso = row?.created_at;
    return iso ? new Date(iso).toLocaleDateString() : "—";
  }
  if (key === "time_only") {
    const iso = row?.created_at;
    return iso ? new Date(iso).toLocaleTimeString() : "—";
  }
  if (v == null) return "—";
  if (key === "created_at") return new Date(v).toLocaleString();
  if (key === "subtotal" || key === "discount_total" || key === "total" || key === "fee_amount")
    return `₱${Number(v).toFixed(2)}`;
  if (key === "order_no") return `#${String(v).padStart(3, "0")}`;
  if (key === "txn_kind") return String(v ?? "sale");
  return String(v);
}

function TxnBadge({ k }: { k: string }) {
  const map: Record<string, string> = { sale: "default", void: "destructive", refund: "outline" };
  return <Badge variant={(map[k] ?? "secondary") as any} className="capitalize">{k}</Badge>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-xl">{value}</div>
    </Card>
  );
}

function StatusBadge({ s, k }: { s: string; k?: string }) {
  const effective = (k && k !== "sale") ? (k === "void" ? "voided" : "refunded") : s;
  const map: Record<string, string> = {
    completed: "default", on_hold: "secondary", voided: "destructive", refunded: "outline", open: "secondary",
  };
  return <Badge variant={(map[effective] ?? "secondary") as any} className="capitalize">{effective.replace("_", " ")}</Badge>;
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

