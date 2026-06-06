import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Trash2, Plus, Minus, ShoppingCart, Coffee, Search, X, Tag, Pause, PlayCircle, ClipboardList, Star, Printer, ScanLine, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { loadPrintSettings } from "@/lib/print-settings";
import { loadPosSettings } from "@/lib/pos-settings";
import { printHTML } from "@/lib/print";
import { receiptHTML, labelsHTML, type DrinkLabel } from "@/lib/print-templates";
import { reprintReceiptById, reprintLabelsById } from "@/lib/reprint";
import { CustomizeDialog } from "@/components/pos/CustomizeDialog";
import {
  type MenuOptions, type SelectedCustom,
  hasAnyCustomization, addonTotal, customSignature, describeCustom,
} from "@/lib/menu-options";

export const Route = createFileRoute("/_authenticated/pos")({
  component: POSPage,
});

type Category = { id: string; name: string; sort_order: number; prints_label?: boolean };
type MenuItem = {
  id: string; category_id: string | null; name: string;
  description: string | null; price: number; is_active: boolean; sort_order: number;
  options: MenuOptions | null;
};
type CartLine = {
  lineId: string;
  menu_item_id: string;
  name: string;
  base_price: number;
  unit_price: number;
  qty: number;
  customization: SelectedCustom | null;
  addon_total: number;
  notes: string | null;
};
type OrderType = "dine_in" | "takeout" | "delivery";
type PMConfig = {
  id: string; code: string; label: string;
  kind: "cash" | "card" | "transfer" | "other";
  fee_percent: number; fee_fixed: number;
  is_active: boolean; sort_order: number;
};
type SplitLine = { method_code: string; amount: string };
type ManualDiscount = { type: "percent" | "fixed"; value: number; label: string } | null;
type Bundle = {
  id: string; name: string; description: string | null; price: number;
  starts_at: string | null; ends_at: string | null; is_active: boolean;
};
type BundleItem = { bundle_id: string; menu_item_id: string; qty: number };

const db = supabase as any;
const fmt = (n: number) => n.toFixed(2);

function POSPage() {
  const { user, primaryRole, roleError } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [cats, setCats] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [pms, setPms] = useState<PMConfig[]>([]);
  const [activeCat, setActiveCat] = useState<string | "all" | "__bundles__">("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("takeout");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [heldOrders, setHeldOrders] = useState<Array<{ id: string; order_no: number; customer_name: string | null; held_at: string; total: number }>>([]);
  const [todayOpen, setTodayOpen] = useState(false);
  const [todayOrders, setTodayOrders] = useState<Array<{ id: string; order_no: number; customer_name: string | null; created_at: string; total: number; order_type: string }>>([]);

  // discount state
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<
    { code: string; label: string; amount: number; applies_to_item_id: string | null } | null
  >(null);
  const [manual, setManual] = useState<ManualDiscount>(null);
  const [topSellers, setTopSellers] = useState<Set<string>>(new Set());
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([]);

  // Barcode / customer loyalty
  type LoyaltyCustomer = {
    id: string; code: string; name: string; phone: string | null; points: number;
    recent_orders: Array<{ id: string; order_no: number; created_at: string; total: number; status: string }>;
  };
  const posSettings = useMemo(() => loadPosSettings(), []);
  const [customer, setCustomer] = useState<LoyaltyCustomer | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [redeem, setRedeem] = useState<string>("");
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const nowIso = new Date().toISOString();
      const [{ data: c }, { data: m }, { data: p }, { data: pop }, { data: bs }, { data: bi }] = await Promise.all([
        db.from("categories").select("id,name,sort_order,prints_label").eq("is_active", true).order("sort_order"),
        db.from("menu_items").select("*").eq("is_active", true).order("sort_order"),
        db.from("payment_methods").select("*").eq("is_active", true).order("sort_order"),
        db.from("menu_item_popularity").select("menu_item_id,qty_sold").order("qty_sold", { ascending: false }).limit(3),
        db.from("bundles").select("*").eq("is_active", true)
          .or(`ends_at.is.null,ends_at.gt.${nowIso}`),
        db.from("bundle_items").select("bundle_id,menu_item_id,qty"),
      ]);
      if (!alive) return;
      setCats((c ?? []) as Category[]);
      setItems((m ?? []) as MenuItem[]);
      setPms((p ?? []) as PMConfig[]);
      setTopSellers(new Set((pop ?? []).map((r: any) => r.menu_item_id as string)));
      // Filter bundles that haven't started yet on the client
      const visibleBundles = ((bs ?? []) as Bundle[]).filter((b) =>
        !b.starts_at || new Date(b.starts_at) <= new Date(),
      );
      setBundles(visibleBundles);
      setBundleItems((bi ?? []) as BundleItem[]);
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

  // Customize dialog state
  const [customizing, setCustomizing] = useState<{
    item: MenuItem;
    initial?: { custom: SelectedCustom | null; qty: number; notes: string };
    editingLineId?: string;
  } | null>(null);

  function newLineId() {
    return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }

  function addItem(it: MenuItem) {
    if (hasAnyCustomization(it.options)) {
      setCustomizing({ item: it });
      return;
    }
    setCart((c) => {
      const sig = customSignature(null, null);
      const f = c.find((l) => l.menu_item_id === it.id && customSignature(l.customization, l.notes) === sig);
      if (f) return c.map((l) => l.lineId === f.lineId ? { ...l, qty: l.qty + 1 } : l);
      const base = Number(it.price);
      return [...c, {
        lineId: newLineId(),
        menu_item_id: it.id, name: it.name,
        base_price: base, unit_price: base, qty: 1,
        customization: null, addon_total: 0, notes: null,
      }];
    });
  }

  function addCustomizedLine(args: {
    item: MenuItem; custom: SelectedCustom; addon: number; qty: number; notes: string;
    editingLineId?: string;
  }) {
    const base = Number(args.item.price);
    const unit = base + args.addon;
    const cleanNotes = args.notes.trim() || null;
    setCart((c) => {
      // If editing an existing line, replace it
      if (args.editingLineId) {
        return c.map((l) => l.lineId === args.editingLineId
          ? { ...l, customization: args.custom, addon_total: args.addon, unit_price: unit, qty: args.qty, notes: cleanNotes }
          : l);
      }
      // Merge if exact same customization+notes already exists
      const sig = customSignature(args.custom, cleanNotes);
      const dup = c.find((l) =>
        l.menu_item_id === args.item.id &&
        customSignature(l.customization, l.notes) === sig);
      if (dup) return c.map((l) => l.lineId === dup.lineId ? { ...l, qty: l.qty + args.qty } : l);
      return [...c, {
        lineId: newLineId(),
        menu_item_id: args.item.id, name: args.item.name,
        base_price: base, unit_price: unit, qty: args.qty,
        customization: args.custom, addon_total: args.addon, notes: cleanNotes,
      }];
    });
  }

  const changeQty = (lineId: string, d: number) =>
    setCart((c) => c.map((l) => l.lineId === lineId ? { ...l, qty: l.qty + d } : l).filter((l) => l.qty > 0));
  const removeLine = (lineId: string) => setCart((c) => c.filter((l) => l.lineId !== lineId));
  function clearAll() {
    setCart([]); setCustomerName("");
    setPromoCode(""); setAppliedPromo(null); setManual(null);
    setCustomer(null); setRedeem(""); setScanInput("");
  }

  async function lookupCustomerByCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    setScanBusy(true);
    try {
      const { data, error } = await db.rpc("customer_lookup", { p_code: code });
      if (error) { toast.error(error.message); return; }
      if (!data) { toast.error(`No customer for code ${code}`); return; }
      const c = data as LoyaltyCustomer;
      setCustomer(c);
      setCustomerName(c.name);
      toast.success(`${c.name} · ${c.points} pts`);
    } finally {
      setScanBusy(false);
      setScanInput("");
      // refocus for the next scan
      requestAnimationFrame(() => scanRef.current?.focus());
    }
  }




  // Auto-focus the scanner input when enabled (re-focus on cart changes)
  useEffect(() => {
    if (!posSettings.scanEnabled || !posSettings.scanAutoFocus) return;
    const t = setTimeout(() => scanRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [posSettings.scanEnabled, posSettings.scanAutoFocus, cart.length, checkoutOpen, holdOpen, todayOpen]);

  function addBundle(b: Bundle) {
    const rows = bundleItems.filter((x) => x.bundle_id === b.id);
    if (rows.length === 0) { toast.error("Bundle has no items"); return; }
    const newLines: CartLine[] = [];
    let componentsTotal = 0;
    for (const r of rows) {
      const it = items.find((x) => x.id === r.menu_item_id);
      if (!it) continue;
      const base = Number(it.price);
      componentsTotal += base * r.qty;
      newLines.push({
        lineId: newLineId(),
        menu_item_id: it.id, name: it.name,
        base_price: base, unit_price: base, qty: r.qty,
        customization: null, addon_total: 0,
        notes: `Bundle: ${b.name}`,
      });
    }
    if (newLines.length === 0) { toast.error("Bundle items unavailable"); return; }
    setCart((c) => [...c, ...newLines]);
    const savings = Math.max(0, componentsTotal - Number(b.price));
    if (savings > 0) {
      setAppliedPromo(null);
      setManual({ type: "fixed", value: savings, label: `Bundle: ${b.name}` });
    }
    toast.success(`${b.name} added`);
  }

  async function holdOrder() {
    if (cart.length === 0) return;
    const { data, error } = await db.rpc("pos_hold_order", {
      p_payload: {
        order_type: orderType,
        customer_name: customerName || null,
        items: cart.map((l) => ({
          menu_item_id: l.menu_item_id, qty: l.qty,
          unit_price: l.unit_price, addon_total: l.addon_total,
          customization: l.customization, notes: l.notes,
        })),
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

  async function openTodayList() {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await db
      .from("orders")
      .select("id, order_no, customer_name, created_at, total, order_type")
      .eq("business_date", today)
      .eq("status", "completed")
      .order("created_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    setTodayOrders((data ?? []) as any);
    setTodayOpen(true);
  }

  async function resumeHeld(id: string) {
    const { data, error } = await db.rpc("pos_resume_order", { p_order_id: id });
    if (error) { toast.error(error.message); return; }
    const r = data as any;
    setCart((r.items ?? []).map((it: any) => {
      const unit = Number(it.unit_price);
      const addon = Number(it.addon_total ?? 0);
      return {
        lineId: newLineId(),
        menu_item_id: it.menu_item_id, name: it.name,
        base_price: unit - addon, unit_price: unit, qty: Number(it.qty),
        customization: (it.customization ?? null) as SelectedCustom | null,
        addon_total: addon,
        notes: it.notes ?? null,
      } as CartLine;
    }));
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

    const itemId: string | null = data.applies_to_item_id ?? null;
    // Compute base the discount applies to
    let base = subtotal;
    if (itemId) {
      base = cart
        .filter((l) => l.menu_item_id === itemId)
        .reduce((s, l) => s + l.unit_price * l.qty, 0);
      if (base <= 0) {
        toast.error(`This promo only applies to a specific item not in cart`);
        return;
      }
    }
    const amt = data.type === "percent"
      ? Math.round(base * Number(data.value)) / 100
      : Math.min(Number(data.value), base);
    setAppliedPromo({
      code: data.code, label: data.name, amount: amt,
      applies_to_item_id: itemId,
    });
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
          <Button size="sm" variant="outline" onClick={openTodayList} className="ml-auto">
            <ClipboardList className="h-3 w-3 mr-1" /> Today
          </Button>
          <Button size="sm" variant="outline" onClick={openHeldList}>
            <PlayCircle className="h-3 w-3 mr-1" /> Held
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search menu…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
          </div>
        </header>

        <div className="px-6 py-3 border-b bg-card flex gap-2 overflow-x-auto">
          <Button size="sm" variant={activeCat === "all" ? "default" : "outline"} onClick={() => setActiveCat("all")}>All</Button>
          {bundles.length > 0 && (
            <Button size="sm"
              variant={activeCat === "__bundles__" ? "default" : "outline"}
              onClick={() => setActiveCat("__bundles__")}>
              🎁 Bundles
            </Button>
          )}
          {cats.map((c) => (
            <Button key={c.id} size="sm" variant={activeCat === c.id ? "default" : "outline"} onClick={() => setActiveCat(c.id)}>
              {c.name}
            </Button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading menu…</div>
          ) : activeCat === "__bundles__" ? (
            bundles.length === 0 ? (
              <div className="text-muted-foreground text-sm">No active bundles.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {bundles.map((b) => {
                  const its = bundleItems.filter((x) => x.bundle_id === b.id);
                  return (
                    <button key={b.id} onClick={() => addBundle(b)}
                      className="relative text-left rounded-lg border-2 border-primary/40 bg-card hover:bg-accent hover:border-primary transition-colors p-4 shadow-sm">
                      <span className="absolute -top-2 -right-2 rounded-full bg-primary text-primary-foreground text-[10px] px-2 py-0.5 shadow">
                        BUNDLE
                      </span>
                      <div className="font-medium leading-tight">{b.name}</div>
                      {b.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{b.description}</div>}
                      <div className="mt-2 text-[11px] text-muted-foreground line-clamp-2">
                        {its.map((r) => {
                          const it = items.find((x) => x.id === r.menu_item_id);
                          return it ? `${it.name} ×${r.qty}` : null;
                        }).filter(Boolean).join(" + ")}
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-2">
                        <div className="font-display text-lg text-primary">{fmt(Number(b.price))}</div>
                        {b.ends_at && (
                          <span className="text-[10px] text-muted-foreground">
                            until {new Date(b.ends_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No items. {items.length === 0 && "Run the Phase 2 SQL to seed the menu."}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map((it) => {
                const isPop = topSellers.has(it.id);
                const customizable = hasAnyCustomization(it.options);
                return (
                  <button key={it.id} onClick={() => addItem(it)}
                    className="relative text-left rounded-lg border bg-card hover:bg-accent hover:border-primary/50 transition-colors p-4 shadow-sm">
                    {isPop && (
                      <span className="absolute -top-2 -right-2 inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-[10px] px-2 py-0.5 shadow">
                        <Star className="h-3 w-3 fill-current" /> Most Ordered
                      </span>
                    )}
                    <div className="font-medium leading-tight">{it.name}</div>
                    {it.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.description}</div>}
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div className="font-display text-lg text-primary">{fmt(Number(it.price))}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Cart side */}
      <aside className="w-full lg:w-[400px] border-t lg:border-t-0 lg:border-l bg-card flex flex-col">
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

          {posSettings.scanEnabled && (
            <div>
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <ScanLine className="h-3 w-3" /> Scan customer barcode
              </label>
              <form
                onSubmit={(e) => { e.preventDefault(); lookupCustomerByCode(scanInput); }}
                className="flex gap-2"
              >
                <Input
                  ref={scanRef}
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  placeholder="Scan or type code…"
                  autoComplete="off"
                  inputMode="numeric"
                  disabled={scanBusy}
                />
                <Button type="submit" variant="outline" size="sm" disabled={scanBusy || !scanInput.trim()}>
                  Find
                </Button>
              </form>
            </div>
          )}

          {customer && (
            <Card className="p-3 bg-accent/40 space-y-2">
              <div className="flex items-start gap-2">
                <UserCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{customer.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    #{customer.code}{customer.phone ? ` · ${customer.phone}` : ""}
                  </div>
                </div>
                <Badge variant="secondary" className="gap-1">
                  <Star className="h-3 w-3" /> {customer.points} pts
                </Badge>
                <Button size="icon" variant="ghost" onClick={() => { setCustomer(null); setRedeem(""); setCustomerName(""); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>

              {customer.points > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-muted-foreground whitespace-nowrap">Redeem pts</label>
                  <Input
                    type="number" min={0} max={customer.points}
                    value={redeem}
                    onChange={(e) => setRedeem(e.target.value)}
                    placeholder="0" className="h-7"
                  />
                </div>
              )}

              {customer.recent_orders && customer.recent_orders.length > 0 && (
                <div className="pt-1 border-t border-border/50">
                  <div className="text-[11px] text-muted-foreground mb-1">
                    Recent orders ({customer.recent_orders.length})
                  </div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {customer.recent_orders.slice(0, 5).map((o) => (
                      <div key={o.id} className="flex justify-between text-[11px]">
                        <span>#{String(o.order_no).padStart(3, "0")} · {new Date(o.created_at).toLocaleDateString()}</span>
                        <span className="font-medium">{fmt(Number(o.total))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {cart.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-10">Tap a menu item to add it.</div>
          ) : (
            cart.map((l) => {
              const desc = describeCustom(l.customization);
              const itemRef = items.find((x) => x.id === l.menu_item_id);
              const editable = hasAnyCustomization(itemRef?.options ?? null);
              return (
                <Card key={l.lineId} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{fmt(l.unit_price)} × {l.qty} = {fmt(l.unit_price * l.qty)}</div>
                      {(desc.length > 0 || l.notes) && (
                        <div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
                          {desc.map((d, i) => <div key={i}>• {d}</div>)}
                          {l.notes && <div className="italic">“{l.notes}”</div>}
                        </div>
                      )}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeLine(l.lineId)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Button size="icon" variant="outline" onClick={() => changeQty(l.lineId, -1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-8 text-center font-medium">{l.qty}</span>
                    <Button size="icon" variant="outline" onClick={() => changeQty(l.lineId, 1)}><Plus className="h-3 w-3" /></Button>
                    {editable && itemRef && (
                      <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs"
                        onClick={() => setCustomizing({
                          item: itemRef,
                          initial: { custom: l.customization, qty: l.qty, notes: l.notes ?? "" },
                          editingLineId: l.lineId,
                        })}>
                        Edit
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })
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
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Button variant="outline" onClick={clearAll} disabled={cart.length === 0}>Clear</Button>
            <Button variant="outline" onClick={holdOrder} disabled={cart.length === 0}>
              <Pause className="h-3 w-3 mr-1" /> Hold
            </Button>
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
          const redeemPts = customer ? Math.max(0, parseInt(redeem || "0", 10) || 0) : 0;
          const payload: any = {
            order_type: orderType,
            customer_id: customer?.id ?? null,
            customer_name: customerName || null,
            redeem_points: redeemPts,
            notes: null,
            items: cart.map((l) => ({
              menu_item_id: l.menu_item_id, qty: l.qty,
              unit_price: l.unit_price, addon_total: l.addon_total,
              customization: l.customization, notes: l.notes,
            })),
            discount_code: appliedPromo?.code ?? null,
            manual_discount: manual,
            payments,
          };
          const { data, error } = await db.rpc("pos_create_order", { p_payload: payload });
          if (error) { toast.error(`Order failed: ${error.message}`); return false; }
          const r = data as { order_no: number; points_earned?: number; points_redeemed?: number };
          const changeTotal = payments.reduce((s, p) => s + p.change_due, 0);
          autoPrint({ orderNo: r.order_no, splits, change: changeTotal });
          const pointsMsg = r.points_earned ? ` · +${r.points_earned} pts` : "";
          toast.success(`Order #${String(r.order_no).padStart(3, "0")} completed${pointsMsg}`);
          clearAll();
          setCheckoutOpen(false);
          return true;
        }}
      />

      {/* Held orders dialog */}
      <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Held orders</DialogTitle></DialogHeader>
          {heldOrders.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No orders on hold.</div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {heldOrders.map((h) => (
                <button key={h.id}
                  onClick={() => resumeHeld(h.id)}
                  className="w-full text-left rounded-md border p-3 hover:bg-accent transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="font-display text-lg">#{String(h.order_no).padStart(3, "0")}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{h.customer_name || "Walk-in"}</div>
                      <div className="text-xs text-muted-foreground">
                        Held {new Date(h.held_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {fmt(Number(h.total))}
                      </div>
                    </div>
                    <PlayCircle className="h-4 w-4 text-primary" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Today's orders dialog */}
      <Dialog open={todayOpen} onOpenChange={setTodayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Today's orders ({todayOrders.length})</DialogTitle></DialogHeader>
          {todayOrders.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No completed orders today yet.</div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {todayOrders.map((o) => (
                <div key={o.id} className="rounded-md border p-3 flex flex-wrap items-center gap-3">
                  <div className="font-display text-lg">#{String(o.order_no).padStart(3, "0")}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{o.customer_name || "Walk-in"}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {o.order_type}
                    </div>
                  </div>
                  <div className="font-medium">{fmt(Number(o.total))}</div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={async () => {
                      try { await reprintReceiptById(o.id, user?.email ?? "—"); }
                      catch (e: any) { toast.error(e.message); }
                    }}>
                      <Printer className="h-3 w-3 mr-1" /> Receipt
                    </Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                      try {
                        const ok = await reprintLabelsById(o.id);
                        if (!ok) toast.message("No drinks to label in this order.");
                      } catch (e: any) { toast.error(e.message); }
                    }}>
                      <Tag className="h-3 w-3 mr-1" /> Labels
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {customizing && (
        <CustomizeDialog
          open
          onOpenChange={(o) => !o && setCustomizing(null)}
          itemName={customizing.item.name}
          basePrice={Number(customizing.item.price)}
          options={customizing.item.options ?? {}}
          initial={customizing.initial}
          onConfirm={(res) => {
            addCustomizedLine({
              item: customizing.item,
              custom: res.custom,
              addon: res.addon,
              qty: res.qty,
              notes: res.notes,
              editingLineId: customizing.editingLineId,
            });
            setCustomizing(null);
          }}
        />
      )}
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
          {splits.length === 1 && lastIsCash && (() => {
            const denoms = [20, 50, 100, 200, 500, 1000];
            const opts: Array<{ label: string; value: number }> = [
              { label: `Exact ${total.toFixed(2)}`, value: Number(total.toFixed(2)) },
              ...denoms.filter((d) => d >= total).map((d) => ({ label: d.toString(), value: d })),
            ];
            // de-dup by value
            const seen = new Set<number>();
            const uniq = opts.filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)));
            return (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Cash given</div>
                <div className="grid grid-cols-4 gap-2">
                  {uniq.map((o, i) => (
                    <Button key={i} size="sm" variant="outline"
                      onClick={() => setSplits([{ method_code: splits[0].method_code, amount: o.value.toFixed(2) }])}>
                      {o.label}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })()}

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
