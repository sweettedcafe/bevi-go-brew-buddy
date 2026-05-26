import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Minus, ShoppingCart, Coffee, Search, X, Tag, Pause, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { loadPrintSettings } from "@/lib/print-settings";
import { printHTML } from "@/lib/print";
import { receiptHTML, labelsHTML, type DrinkLabel } from "@/lib/print-templates";

export const Route = createFileRoute("/_authenticated/pos")({
  component: POSPage,
});

type Category = { id: string; name: string; sort_order: number; prints_label?: boolean };
type MenuItem = {
  id: string; category_id: string | null; name: string;
  description: string | null; price: number; is_active: boolean; sort_order: number;
};
type CartLine = { menu_item_id: string; name: string; unit_price: number; qty: number };
type OrderType = "dine_in" | "takeout" | "delivery";
type PMConfig = {
  id: string; code: string; label: string;
  kind: "cash" | "card" | "transfer" | "other";
  fee_percent: number; fee_fixed: number;
  is_active: boolean; sort_order: number;
};
type SplitLine = { method_code: string; amount: string };
type ManualDiscount = { type: "percent" | "fixed"; value: number; label: string } | null;

const db = supabase as any;
const fmt = (n: number) => n.toFixed(2);

function POSPage() {
  const { user, primaryRole, roleError } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [cats, setCats] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [pms, setPms] = useState<PMConfig[]>([]);
  const [activeCat, setActiveCat] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("takeout");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [heldOrders, setHeldOrders] = useState<Array<{ id: string; order_no: number; customer_name: string | null; held_at: string; total: number }>>([]);

  // discount state
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; label: string; amount: number } | null>(null);
  const [manual, setManual] = useState<ManualDiscount>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: c }, { data: m }, { data: p }] = await Promise.all([
        db.from("categories").select("id,name,sort_order,prints_label").eq("is_active", true).order("sort_order"),
        db.from("menu_items").select("*").eq("is_active", true).order("sort_order"),
        db.from("payment_methods").select("*").eq("is_active", true).order("sort_order"),
      ]);
      if (!alive) return;
      setCats((c ?? []) as Category[]);
      setItems((m ?? []) as MenuItem[]);
      setPms((p ?? []) as PMConfig[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (activeCat === "all" || i.category_id === activeCat) &&
        (q === "" || i.name.toLowerCase().includes(q)),
    );
  }, [items, activeCat, query]);

  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);

  const discountAmount = useMemo(() => {
    if (appliedPromo) return Math.min(appliedPromo.amount, subtotal);
    if (manual) {
      const raw = manual.type === "percent"
        ? subtotal * (manual.value / 100)
        : manual.value;
      return Math.min(Math.max(0, raw), subtotal);
    }
    return 0;
  }, [appliedPromo, manual, subtotal]);

  const total = Math.max(0, subtotal - discountAmount);

  function addItem(it: MenuItem) {
    setCart((c) => {
      const f = c.find((l) => l.menu_item_id === it.id);
      if (f) return c.map((l) => l.menu_item_id === it.id ? { ...l, qty: l.qty + 1 } : l);
      return [...c, { menu_item_id: it.id, name: it.name, unit_price: Number(it.price), qty: 1 }];
    });
  }
  const changeQty = (id: string, d: number) =>
    setCart((c) => c.map((l) => l.menu_item_id === id ? { ...l, qty: l.qty + d } : l).filter((l) => l.qty > 0));
  const removeLine = (id: string) => setCart((c) => c.filter((l) => l.menu_item_id !== id));
  function clearAll() {
    setCart([]); setCustomerName("");
    setPromoCode(""); setAppliedPromo(null); setManual(null);
  }

  async function holdOrder() {
    if (cart.length === 0) return;
    const { data, error } = await db.rpc("pos_hold_order", {
      p_payload: {
        order_type: orderType,
        customer_name: customerName || null,
        items: cart.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty })),
      },
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Order #${String((data as any).order_no).padStart(3, "0")} held`);
    clearAll();
  }

  async function openHeldList() {
    const { data, error } = await db
      .from("orders")
      .select("id, order_no, customer_name, held_at, total")
      .eq("status", "on_hold")
      .order("held_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    setHeldOrders((data ?? []) as any);
    setHoldOpen(true);
  }

  async function resumeHeld(id: string) {
    const { data, error } = await db.rpc("pos_resume_order", { p_order_id: id });
    if (error) { toast.error(error.message); return; }
    const r = data as any;
    setCart((r.items ?? []).map((it: any) => ({
      menu_item_id: it.menu_item_id, name: it.name,
      unit_price: Number(it.unit_price), qty: Number(it.qty),
    })));
    setCustomerName(r.customer_name ?? "");
    setOrderType((r.order_type as OrderType) ?? "takeout");
    setHoldOpen(false);
    toast.success("Order resumed");
  }

  function autoPrint(args: {
    orderNo: number;
    splits: SplitLine[];
    change: number;
  }) {
    const settings = loadPrintSettings();
    const labelCatIds = new Set(cats.filter((c) => c.prints_label).map((c) => c.id));
    const now = new Date().toISOString();
    const pmLabel = (code: string) => pms.find((p) => p.code === code)?.label ?? code;

    if (settings.autoPrintReceipt) {
      printHTML(receiptHTML({
        orderNo: args.orderNo,
        businessDate: new Date().toISOString().slice(0, 10),
        createdAt: now,
        cashier: user?.email ?? "—",
        orderType,
        customerName: customerName || null,
        lines: cart.map((l) => ({
          name: l.name, qty: l.qty, unit_price: l.unit_price, line_total: l.unit_price * l.qty,
        })),
        subtotal,
        discountLabel: appliedPromo?.label ?? manual?.label ?? null,
        discountAmount: discountAmount,
        total,
        payments: args.splits.map((s) => ({ label: pmLabel(s.method_code), amount: Number(s.amount) || 0 })),
        change: args.change,
      }, settings), `Receipt #${args.orderNo}`);
    }

    if (settings.autoPrintLabels) {
      const labels: DrinkLabel[] = [];
      for (const line of cart) {
        const item = items.find((x) => x.id === line.menu_item_id);
        if (!item || !item.category_id || !labelCatIds.has(item.category_id)) continue;
        for (let i = 1; i <= line.qty; i++) {
          labels.push({
            orderNo: args.orderNo,
            drinkName: line.name,
            cupIndex: i, cupTotal: line.qty,
            customerName: customerName || null,
            notes: null,
            createdAt: now,
          });
        }
      }
      if (labels.length > 0) {
        // small delay so the receipt iframe doesn't race the label iframe
        setTimeout(() => printHTML(labelsHTML(labels, settings), `Labels #${args.orderNo}`), 700);
      }
    }
  }

  async function applyPromo() {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    const { data, error } = await db
      .from("discounts").select("*")
      .eq("code", code).eq("is_active", true).maybeSingle();
    if (error || !data) { toast.error("Invalid promo code"); return; }
    if (data.min_subtotal && subtotal < Number(data.min_subtotal)) {
      toast.error(`Min subtotal ${fmt(Number(data.min_subtotal))}`); return;
    }
    if (data.ends_at && new Date(data.ends_at) < new Date()) { toast.error("Promo expired"); return; }
    if (data.starts_at && new Date(data.starts_at) > new Date()) { toast.error("Promo not started"); return; }
    if (data.max_uses != null && data.uses_count >= data.max_uses) { toast.error("Promo usage limit reached"); return; }
    const amt = data.type === "percent"
      ? Math.round(subtotal * Number(data.value)) / 100 * 100 / 100
      : Number(data.value);
    setAppliedPromo({ code: data.code, label: data.name, amount: amt });
    setManual(null);
    toast.success(`Promo "${data.name}" applied`);
  }

  if (!primaryRole) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        {roleError?.toLowerCase().includes("permission denied")
          ? "The app cannot read your role yet. Run the database permissions fix SQL, then refresh."
          : "Your account has no role assigned yet. Ask an admin to grant access."}
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:h-screen flex flex-col lg:flex-row bg-background">
      {/* Menu side */}
      <section className="flex-1 flex flex-col min-w-0">
        <header className="px-4 sm:px-6 py-3 sm:py-4 border-b bg-card flex flex-wrap items-center gap-3">
          <Coffee className="h-5 w-5 text-primary" />
          <h1 className="text-lg sm:text-xl font-display">Point of Sale</h1>
          <Button size="sm" variant="outline" onClick={openHeldList} className="ml-auto">
            <PlayCircle className="h-3 w-3 mr-1" /> Held orders
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search menu…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
          </div>
        </header>

        <div className="px-6 py-3 border-b bg-card flex gap-2 overflow-x-auto">
          <Button size="sm" variant={activeCat === "all" ? "default" : "outline"} onClick={() => setActiveCat("all")}>All</Button>
          {cats.map((c) => (
            <Button key={c.id} size="sm" variant={activeCat === c.id ? "default" : "outline"} onClick={() => setActiveCat(c.id)}>
              {c.name}
            </Button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading menu…</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No items. {items.length === 0 && "Run the Phase 2 SQL to seed the menu."}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map((it) => (
                <button key={it.id} onClick={() => addItem(it)}
                  className="text-left rounded-lg border bg-card hover:bg-accent hover:border-primary/50 transition-colors p-4 shadow-sm">
                  <div className="font-medium leading-tight">{it.name}</div>
                  {it.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.description}</div>}
                  <div className="mt-3 font-display text-lg text-primary">{fmt(Number(it.price))}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Cart side */}
      <aside className="w-[400px] border-l bg-card flex flex-col">
        <div className="p-4 border-b flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" />
          <h2 className="font-display text-lg">Current Order</h2>
          <Badge variant="secondary" className="ml-auto">{cart.reduce((n, l) => n + l.qty, 0)} items</Badge>
        </div>

        <div className="p-4 border-b space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Order type</label>
            <Select value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="takeout">Takeout</SelectItem>
                <SelectItem value="dine_in">Dine in</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Customer name (optional)</label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Ahmed" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {cart.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-10">Tap a menu item to add it.</div>
          ) : (
            cart.map((l) => (
              <Card key={l.menu_item_id} className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{fmt(l.unit_price)} × {l.qty} = {fmt(l.unit_price * l.qty)}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeLine(l.menu_item_id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button size="icon" variant="outline" onClick={() => changeQty(l.menu_item_id, -1)}><Minus className="h-3 w-3" /></Button>
                  <span className="w-8 text-center font-medium">{l.qty}</span>
                  <Button size="icon" variant="outline" onClick={() => changeQty(l.menu_item_id, 1)}><Plus className="h-3 w-3" /></Button>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Promo + manual discount */}
        <div className="px-4 pt-3 pb-2 border-t space-y-2">
          {appliedPromo ? (
            <div className="flex items-center gap-2 bg-primary/10 rounded px-3 py-2 text-sm">
              <Tag className="h-3 w-3 text-primary" />
              <span className="font-medium">{appliedPromo.code}</span>
              <span className="text-muted-foreground">−{fmt(discountAmount)}</span>
              <Button size="icon" variant="ghost" className="ml-auto h-6 w-6"
                onClick={() => { setAppliedPromo(null); setPromoCode(""); }}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : manual ? (
            <div className="flex items-center gap-2 bg-secondary rounded px-3 py-2 text-sm">
              <Tag className="h-3 w-3" />
              <span className="font-medium">{manual.label}</span>
              <span className="text-muted-foreground">−{fmt(discountAmount)}</span>
              <Button size="icon" variant="ghost" className="ml-auto h-6 w-6" onClick={() => setManual(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input placeholder="Promo code" value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyPromo()} />
              <Button variant="outline" onClick={applyPromo} disabled={cart.length === 0}>Apply</Button>
            </div>
          )}
          {isAdmin && !appliedPromo && !manual && cart.length > 0 && (
            <ManualDiscountControl subtotal={subtotal} onApply={setManual} />
          )}
        </div>

        <div className="p-4 border-t space-y-2 bg-card">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-sm text-primary">
              <span>Discount</span>
              <span>−{fmt(discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-display text-xl">
            <span>Total</span>
            <span className="text-primary">{fmt(total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="outline" onClick={clearAll} disabled={cart.length === 0}>Clear</Button>
            <Button onClick={() => setCheckoutOpen(true)} disabled={cart.length === 0}>Charge</Button>
          </div>
          <div className="text-[10px] text-muted-foreground text-center">Cashier: {user?.email}</div>
        </div>
      </aside>

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        total={total}
        methods={pms}
        onConfirm={async (splits) => {
          const payments = splits.map((s) => {
            const pm = pms.find((x) => x.code === s.method_code)!;
            const amt = Number(s.amount) || 0;
            const fee = Math.round((amt * pm.fee_percent + pm.fee_fixed * 100)) / 100;
            return {
              method_code: pm.code,
              method: pm.kind,
              amount: amt,
              change_due: 0,
              fee_amount: fee,
              reference: null,
            };
          });
          // single cash overpay → change
          if (payments.length === 1 && payments[0].method === "cash") {
            payments[0].change_due = Math.max(0, payments[0].amount - total);
          }
          const payload: any = {
            order_type: orderType,
            customer_name: customerName || null,
            notes: null,
            items: cart.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty })),
            discount_code: appliedPromo?.code ?? null,
            manual_discount: manual,
            payments,
          };
          const { data, error } = await db.rpc("pos_create_order", { p_payload: payload });
          if (error) { toast.error(`Order failed: ${error.message}`); return false; }
          const r = data as { order_no: number };
          toast.success(`Order #${String(r.order_no).padStart(3, "0")} completed`);
          clearAll();
          setCheckoutOpen(false);
          return true;
        }}
      />
    </div>
  );
}

function ManualDiscountControl({
  subtotal, onApply,
}: { subtotal: number; onApply: (m: ManualDiscount) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("10");
  const [label, setLabel] = useState("Manager discount");
  if (!open) {
    return (
      <button className="text-xs text-muted-foreground hover:text-foreground underline"
        onClick={() => setOpen(true)}>
        + Manager manual discount
      </button>
    );
  }
  return (
    <div className="border rounded p-2 space-y-2 text-sm">
      <div className="flex gap-2">
        <Select value={type} onValueChange={(v) => setType(v as any)}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="percent">%</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
          </SelectContent>
        </Select>
        <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Reason" />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={() => {
          const v = Number(value);
          if (!v || v <= 0) { toast.error("Enter a value"); return; }
          if (type === "percent" && v > 100) { toast.error("Max 100%"); return; }
          if (type === "fixed" && v > subtotal) { toast.error("Exceeds subtotal"); return; }
          onApply({ type, value: v, label: label.trim() || "Manual discount" });
          setOpen(false);
        }}>Apply</Button>
      </div>
    </div>
  );
}

function CheckoutDialog({
  open, onOpenChange, total, methods, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  total: number;
  methods: PMConfig[];
  onConfirm: (splits: SplitLine[]) => Promise<boolean>;
}) {
  const [splits, setSplits] = useState<SplitLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const def = methods[0];
      setSplits(def ? [{ method_code: def.code, amount: total.toFixed(2) }] : []);
    }
  }, [open, total, methods]);

  const paid = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const lastIsCash = (() => {
    const last = splits[splits.length - 1];
    const pm = last && methods.find((m) => m.code === last.method_code);
    return pm?.kind === "cash";
  })();
  const remaining = total - paid;
  const short = paid < total && !(lastIsCash && splits.length === 1);
  const change = splits.length === 1 && lastIsCash ? Math.max(0, paid - total) : 0;

  // total fees preview
  const totalFee = splits.reduce((s, x) => {
    const pm = methods.find((m) => m.code === x.method_code);
    if (!pm) return s;
    const amt = Number(x.amount) || 0;
    return s + (amt * pm.fee_percent / 100) + pm.fee_fixed;
  }, 0);

  function setSplit(i: number, patch: Partial<SplitLine>) {
    setSplits((arr) => arr.map((s, k) => k === i ? { ...s, ...patch } : s));
  }
  function addSplit() {
    const remain = Math.max(0, total - paid);
    const def = methods[0];
    if (!def) return;
    setSplits((arr) => [...arr, { method_code: def.code, amount: remain.toFixed(2) }]);
  }
  function removeSplit(i: number) {
    setSplits((arr) => arr.filter((_, k) => k !== i));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Take Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-between font-display text-2xl">
            <span>Total due</span>
            <span className="text-primary">{total.toFixed(2)}</span>
          </div>

          <div className="space-y-2">
            {splits.map((s, i) => {
              const pm = methods.find((m) => m.code === s.method_code);
              return (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    {i === 0 && <label className="text-xs text-muted-foreground">Method</label>}
                    <Select value={s.method_code} onValueChange={(v) => setSplit(i, { method_code: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {methods.map((m) => (
                          <SelectItem key={m.code} value={m.code}>
                            {m.label}{m.fee_percent > 0 ? ` (+${m.fee_percent}%)` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32">
                    {i === 0 && <label className="text-xs text-muted-foreground">Amount</label>}
                    <Input type="number" inputMode="decimal" value={s.amount}
                      onChange={(e) => setSplit(i, { amount: e.target.value })} />
                  </div>
                  {splits.length > 1 && (
                    <Button size="icon" variant="ghost" onClick={() => removeSplit(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  {pm?.kind === "cash" && i === splits.length - 1 && splits.length === 1 && (
                    <div className="hidden" />
                  )}
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={addSplit} disabled={remaining <= 0}>
              <Plus className="h-3 w-3 mr-1" /> Split payment
            </Button>
          </div>

          {/* Quick cash tendered shortcuts (only when single cash line) */}
          {splits.length === 1 && lastIsCash && (
            <div className="grid grid-cols-4 gap-2">
              {[total, Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50].map((v, i) => (
                <Button key={i} size="sm" variant="outline"
                  onClick={() => setSplits([{ method_code: splits[0].method_code, amount: v.toFixed(2) }])}>
                  {v.toFixed(2)}
                </Button>
              ))}
            </div>
          )}

          <div className="border-t pt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>{paid.toFixed(2)}</span></div>
            {totalFee > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Processing fees</span><span>{totalFee.toFixed(2)}</span>
              </div>
            )}
            {short ? (
              <div className="flex justify-between text-destructive">
                <span>Short</span><span>{(total - paid).toFixed(2)}</span>
              </div>
            ) : change > 0 ? (
              <div className="flex justify-between font-medium">
                <span>Change</span><span>{change.toFixed(2)}</span>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button disabled={submitting || short}
            onClick={async () => {
              setSubmitting(true);
              await onConfirm(splits);
              setSubmitting(false);
            }}>
            {submitting ? "Processing…" : "Confirm Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
