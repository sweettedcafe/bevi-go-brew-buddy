import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Printer, Receipt as ReceiptIcon, Tag, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { loadPrintSettings } from "@/lib/print-settings";
import { printHTML } from "@/lib/print";
import { receiptHTML, labelsHTML, type ReceiptData, type DrinkLabel } from "@/lib/print-templates";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

const db = supabase as any;

type Row = {
  id: string;
  order_no: number;
  business_date: string;
  status: string;
  order_type: string;
  customer_name: string | null;
  subtotal: number;
  discount_total: number;
  discount_label: string | null;
  total: number;
  created_at: string;
  cashier_id: string | null;
};

function HistoryPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    const today = new Date();
    const tz = "Asia/Riyadh";
    // simple: business_date = today in local TZ used by server
    const d = new Date(today.toLocaleString("en-US", { timeZone: tz }));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const { data, error } = await db
      .from("orders")
      .select("*")
      .eq("business_date", iso)
      .in("status", ["completed", "refunded", "voided"])
      .order("order_no", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = q.trim()
    ? rows.filter((r) =>
        String(r.order_no).includes(q.trim()) ||
        (r.customer_name ?? "").toLowerCase().includes(q.trim().toLowerCase()))
    : rows;

  async function buildReceipt(r: Row): Promise<ReceiptData | null> {
    const [{ data: items }, { data: payments }] = await Promise.all([
      db.from("order_items").select("*").eq("order_id", r.id).order("created_at"),
      db.from("order_payments").select("*").eq("order_id", r.id).order("created_at"),
    ]);
    const pms = await db.from("payment_methods").select("code,label");
    const labelMap = new Map<string, string>(
      ((pms.data ?? []) as { code: string; label: string }[]).map((p) => [p.code, p.label]),
    );
    return {
      orderNo: r.order_no,
      businessDate: r.business_date,
      createdAt: r.created_at,
      cashier: user?.email ?? "—",
      orderType: r.order_type,
      customerName: r.customer_name,
      lines: (items ?? []).map((l: any) => ({
        name: l.name_snapshot, qty: l.qty,
        unit_price: Number(l.unit_price), line_total: Number(l.line_total),
      })),
      subtotal: Number(r.subtotal),
      discountLabel: r.discount_label,
      discountAmount: Number(r.discount_total),
      total: Number(r.total),
      payments: (payments ?? []).map((p: any) => ({
        label: labelMap.get(p.method_code) ?? p.method_code ?? p.method ?? "Payment",
        amount: Number(p.amount),
      })),
      change: (payments ?? []).reduce((s: number, p: any) => s + Number(p.change_due ?? 0), 0),
    };
  }

  async function reprintReceipt(r: Row) {
    const data = await buildReceipt(r);
    if (!data) return;
    printHTML(receiptHTML(data, loadPrintSettings()), `Receipt #${r.order_no}`);
  }

  async function reprintLabels(r: Row) {
    const { data: items } = await db
      .from("order_items")
      .select("menu_item_id, name_snapshot, qty, notes, menu_items(category_id, categories(prints_label))")
      .eq("order_id", r.id);
    const labels: DrinkLabel[] = [];
    for (const it of (items ?? []) as any[]) {
      const isDrink = it.menu_items?.categories?.prints_label === true;
      if (!isDrink) continue;
      const total = Number(it.qty);
      for (let i = 1; i <= total; i++) {
        labels.push({
          orderNo: r.order_no,
          drinkName: it.name_snapshot,
          cupIndex: i, cupTotal: total,
          customerName: r.customer_name,
          notes: it.notes,
          createdAt: r.created_at,
        });
      }
    }
    if (labels.length === 0) { toast.message("No drinks to label in this order."); return; }
    printHTML(labelsHTML(labels, loadPrintSettings()), `Labels #${r.order_no}`);
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <header className="flex flex-wrap items-center gap-3 mb-4">
        <ReceiptIcon className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Today's Orders</h1>
        <Button size="sm" variant="outline" className="ml-auto" onClick={load}>
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </header>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search order # or customer" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm">No orders yet today.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Card key={r.id} className="p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="font-display text-lg w-16">#{String(r.order_no).padStart(3, "0")}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {r.customer_name || "Walk-in"} · <span className="text-muted-foreground capitalize">{r.order_type.replace("_", " ")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <Badge variant={r.status === "completed" ? "default" : "secondary"} className="capitalize">{r.status}</Badge>
                <div className="font-display text-lg text-primary w-20 text-right">{Number(r.total).toFixed(2)}</div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => reprintReceipt(r)}>
                    <Printer className="h-3 w-3 mr-1" /> Receipt
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => reprintLabels(r)}>
                    <Tag className="h-3 w-3 mr-1" /> Labels
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
