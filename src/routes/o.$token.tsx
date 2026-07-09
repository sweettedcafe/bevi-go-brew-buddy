import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coffee, Plus, Minus, Star, Trash2, Package, BellRing } from "lucide-react";
import { toast } from "sonner";
import { CustomizeDialog, type VariantChoice } from "@/components/pos/CustomizeDialog";
import { UpsellDialog, type UpsellChoice } from "@/components/pos/UpsellDialog";
import {
  type MenuOptions, type SelectedCustom,
  hasAnyCustomization, customSignature, describeCustom,
} from "@/lib/menu-options";

export const Route = createFileRoute("/o/$token")({ component: SelfOrderPage });

const db = supabase as any;
const fmt = (n: number) => n.toFixed(2);

type Item = {
  id: string; category_id: string | null; name: string; description: string | null;
  price: number; options: MenuOptions | null; has_variants?: boolean;
};
type Cat = { id: string; name: string; sort_order: number };
type Variant = { id: string; menu_item_id: string; name: string; price: number; sort_order: number };
type Bundle = { id: string; name: string; description: string | null; price: number };
type BundleItem = {
  bundle_id: string; menu_item_id: string; qty: number;
  discount_type: "percent" | "fixed"; discount_value: number;
};
type CartLine = {
  lineId: string;
  kind: "item" | "bundle";
  menu_item_id: string | null;
  bundle_id: string | null;
  name: string;
  unit_price: number; qty: number; addon_total: number;
  customization: SelectedCustom | null; notes: string | null;
  variant_id: string | null;
  is_upsell?: boolean;
};

function SelfOrderPage() {
  const { token } = Route.useParams();
  const [customer, setCustomer] = useState<{ id: string; name: string; points: number } | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([]);
  const [activeCat, setActiveCat] = useState<string | "all" | "__bundles__">("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [done, setDone] = useState<{ order_no: number; order_id: string; total: number } | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [alerting, setAlerting] = useState(false);
  // Once the customer dismisses the alert for an order, don't re-alert
  const dismissedRef = useRef<Set<string>>(new Set());

  async function loadMenu() {
    const { data: m } = await db.rpc("public_menu");
    const d: any = m ?? {};
    setCats((d.categories ?? []) as Cat[]);
    setItems((d.items ?? []) as Item[]);
    setVariants((d.variants ?? []) as Variant[]);
    setBundles((d.bundles ?? []) as Bundle[]);
    setBundleItems((d.bundle_items ?? []) as BundleItem[]);
  }

  useEffect(() => {
    (async () => {
      const { data: c } = await db.rpc("customer_by_token", { p_token: token });
      if (!c) { toast.error("Invalid or expired QR code"); setLoading(false); return; }
      setCustomer(c as any);
      await loadMenu();
      setLoading(false);
    })();
  }, [token]);

  // Realtime: reflect admin's menu changes immediately
  useEffect(() => {
    const ch = supabase
      .channel("self-order-menu")
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, () => loadMenu())
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => loadMenu())
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_item_variants" }, () => loadMenu())
      .on("postgres_changes", { event: "*", schema: "public", table: "bundles" }, () => loadMenu())
      .on("postgres_changes", { event: "*", schema: "public", table: "bundle_items" }, () => loadMenu())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Poll order status while awaiting pickup, and alert when ready
  useEffect(() => {
    if (!done) { setOrderStatus(null); return; }
    let cancelled = false;
    async function check() {
      const { data } = await db.rpc("customer_order_status", {
        p_token: token, p_order_id: done!.order_id,
      });
      if (cancelled || !data) return;
      const s = (data as any).status as string;
      const alerted = Boolean((data as any).alerted);
      setOrderStatus(s);
      if (alerted && !dismissedRef.current.has(done!.order_id)) {
        setAlerting(true);
      }
    }
    void check();
    const t = window.setInterval(check, 5000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [done, token]);

  // Ready alert: vibrate + beep in a loop until user taps stop
  const audioRef = useRef<{ ctx: AudioContext; timer: number } | null>(null);
  useEffect(() => {
    if (!alerting) return;
    // vibration pattern loop
    const vibrate = () => {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        // pattern: buzz-pause-buzz
        (navigator as any).vibrate([400, 150, 400, 150, 400]);
      }
    };
    vibrate();
    const vTimer = window.setInterval(vibrate, 2000);

    // audio beep loop
    let ctx: AudioContext | null = null;
    let aTimer = 0;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC) {
        ctx = new AC();
        const beep = () => {
          if (!ctx) return;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine"; o.frequency.value = 880;
          g.gain.setValueAtTime(0.001, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
          o.connect(g).connect(ctx.destination);
          o.start(); o.stop(ctx.currentTime + 0.55);
        };
        beep();
        aTimer = window.setInterval(beep, 1200);
        audioRef.current = { ctx: ctx as AudioContext, timer: aTimer };
      }
    } catch { /* ignore */ }

    return () => {
      window.clearInterval(vTimer);
      if (aTimer) window.clearInterval(aTimer);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { (navigator as any).vibrate(0); } catch { /* noop */ }
      }
      try { ctx?.close(); } catch { /* noop */ }
      audioRef.current = null;
    };
  }, [alerting]);

  const filtered = useMemo(
    () => items.filter((i) => activeCat === "all" || i.category_id === activeCat),
    [items, activeCat],
  );
  const cartSubtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const itemVariants = (id: string) =>
    variants.filter((v) => v.menu_item_id === id).sort((a, b) => a.sort_order - b.sort_order);

  function newId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }

  // Upsell suggestions after adding an item
  const [upsell, setUpsell] = useState<{ trigger: string; suggestions: UpsellChoice[] } | null>(null);
  function maybeOfferUpsell(it: Item, currentCart: CartLine[]) {
    const ids = it.options?.upsell_item_ids ?? [];
    if (!ids.length) return;
    const suggestions: UpsellChoice[] = ids
      .map((id) => items.find((x) => x.id === id))
      .filter((x): x is Item => !!x)
      .filter((x) => !currentCart.some((l) => l.menu_item_id === x.id))
      .map((x) => ({ id: x.id, name: x.name, price: Number(x.price) }));
    if (suggestions.length === 0) return;
    setUpsell({ trigger: it.name, suggestions });
  }

  function tap(it: Item) {
    const vs = itemVariants(it.id);
    const needsDialog = vs.length > 0 || hasAnyCustomization(it.options);
    if (needsDialog) { setCustomizing(it); return; }
    setCart((c) => {
      const f = c.find((l) =>
        l.kind === "item" &&
        l.menu_item_id === it.id && !l.customization && !l.notes && !l.variant_id);
      if (f) return c.map((l) => l.lineId === f.lineId ? { ...l, qty: l.qty + 1 } : l);
      return [...c, {
        lineId: newId(), kind: "item",
        menu_item_id: it.id, bundle_id: null, name: it.name,
        unit_price: Number(it.price), qty: 1, addon_total: 0,
        customization: null, notes: null, variant_id: null,
      }];
    });
    maybeOfferUpsell(it, cart);
  }

  function addBundle(b: Bundle) {
    const rows = bundleItems.filter((x) => x.bundle_id === b.id);
    if (rows.length === 0) { toast.error("Bundle is empty"); return; }
    // compute effective bundle price from its component discounts
    let price = 0;
    for (const r of rows) {
      const it = items.find((i) => i.id === r.menu_item_id);
      if (!it) continue;
      const base = Number(it.price);
      const unit = r.discount_type === "percent"
        ? Math.max(0, base - base * (Number(r.discount_value) || 0) / 100)
        : Math.max(0, base - (Number(r.discount_value) || 0));
      price += unit * r.qty;
    }
    price = Math.round(price * 100) / 100;
    setCart((c) => {
      const f = c.find((l) => l.kind === "bundle" && l.bundle_id === b.id);
      if (f) return c.map((l) => l.lineId === f.lineId ? { ...l, qty: l.qty + 1 } : l);
      return [...c, {
        lineId: newId(), kind: "bundle",
        menu_item_id: null, bundle_id: b.id, name: b.name,
        unit_price: price, qty: 1, addon_total: 0,
        customization: null, notes: null, variant_id: null,
      }];
    });
    toast.success(`${b.name} added`);
  }

  function addCustom(it: Item, res: {
    custom: SelectedCustom; addon: number; qty: number; notes: string;
    variant: VariantChoice | null;
  }) {
    const base = res.variant ? Number(res.variant.price) : Number(it.price);
    const unit = base + res.addon;
    const notes = res.notes.trim() || null;
    const name = res.variant ? `${it.name} — ${res.variant.name}` : it.name;
    setCart((c) => {
      const sig = customSignature(res.custom, notes) + `|V:${res.variant?.id ?? ""}`;
      const dup = c.find((l) => l.kind === "item" && l.menu_item_id === it.id
        && (customSignature(l.customization, l.notes) + `|V:${l.variant_id ?? ""}`) === sig);
      if (dup) return c.map((l) => l.lineId === dup.lineId ? { ...l, qty: l.qty + res.qty } : l);
      return [...c, {
        lineId: newId(), kind: "item",
        menu_item_id: it.id, bundle_id: null, name,
        unit_price: unit, qty: res.qty, addon_total: res.addon,
        customization: res.custom, notes, variant_id: res.variant?.id ?? null,
      }];
    });
  }

  async function place() {
    if (cart.length === 0) return;
    setPlacing(true);
    const { data, error } = await db.rpc("customer_self_order", {
      p_token: token,
      p_payload: {
        order_type: "takeout",
        items: cart.filter((l) => l.kind === "item").map((l) => ({
          menu_item_id: l.menu_item_id, qty: l.qty,
          addon_total: l.addon_total, customization: l.customization, notes: l.notes,
        })),
        bundles: cart.filter((l) => l.kind === "bundle").map((l) => ({
          bundle_id: l.bundle_id, qty: l.qty,
        })),
      },
    });
    setPlacing(false);
    if (error) { toast.error(error.message); return; }
    const r = data as any;
    setDone({ order_no: r.order_no, order_id: r.order_id, total: Number(r.total) });
    setCart([]);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (!customer) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground p-6 text-center">Sorry, this QR is no longer valid. Please ask the barista to issue a new one.</div>;

  if (done) {
    const ready = orderStatus === "completed";
    const voided = orderStatus === "voided";
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full p-6 text-center space-y-3">
          <Coffee className="h-8 w-8 text-primary mx-auto" />
          <h1 className="font-display text-2xl">
            {ready ? "Your order is ready!" : voided ? "Order cancelled" : "Order placed!"}
          </h1>
          <div className="text-sm text-muted-foreground">
            {ready
              ? "Please pick it up from the counter."
              : voided
                ? "This order was voided by the barista."
                : "Show this number at the counter to pay."}
          </div>
          <div className="font-display text-5xl text-primary">#{String(done.order_no).padStart(3,"0")}</div>
          <div className="text-[10px] text-muted-foreground font-mono break-all">ID: {done.order_id}</div>
          <div className="text-lg">Total ₱{fmt(done.total)}</div>
          {!ready && !voided && (
            <div className="text-xs text-muted-foreground">
              Pay with cash at the counter — this page will alert you when your order is ready.
            </div>
          )}
          {alerting && (
            <Button className="w-full" size="lg" variant="destructive"
              onClick={() => {
                if (done) dismissedRef.current.add(done.order_id);
                setAlerting(false);
              }}>
              <BellRing className="h-4 w-4 mr-2 animate-pulse" /> Stop alert
            </Button>
          )}
          <Button className="w-full" variant={alerting ? "outline" : "default"}
            onClick={() => {
              if (done) dismissedRef.current.add(done.order_id);
              setAlerting(false); setDone(null);
            }}>
            Order again
          </Button>
        </Card>
      </div>
    );
  }

  const customizingVariants = customizing ? itemVariants(customizing.id) : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card border-b px-4 py-3 flex items-center gap-3">
        <Coffee className="h-5 w-5 text-primary" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">Hi, {customer.name}</div>
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Star className="h-3 w-3 text-primary fill-current" /> {customer.points} pts
          </div>
        </div>
      </header>

      <div className="px-3 py-2 border-b bg-card flex gap-2 overflow-x-auto">
        <Button size="sm" variant={activeCat === "all" ? "default" : "outline"} onClick={() => setActiveCat("all")}>All</Button>
        {bundles.length > 0 && (
          <Button size="sm" variant={activeCat === "__bundles__" ? "default" : "outline"} onClick={() => setActiveCat("__bundles__")}>
            <Package className="h-3 w-3 mr-1" /> Bundles
          </Button>
        )}
        {cats.map((c) => (
          <Button key={c.id} size="sm" variant={activeCat === c.id ? "default" : "outline"} onClick={() => setActiveCat(c.id)}>{c.name}</Button>
        ))}
      </div>

      <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pb-56 max-w-3xl mx-auto">
        {activeCat === "__bundles__" ? (
          bundles.length === 0 ? (
            <div className="col-span-full text-muted-foreground text-sm">No active bundles.</div>
          ) : bundles.map((b) => {
            const rows = bundleItems.filter((x) => x.bundle_id === b.id);
            let price = 0;
            for (const r of rows) {
              const it = items.find((i) => i.id === r.menu_item_id);
              if (!it) continue;
              const base = Number(it.price);
              const unit = r.discount_type === "percent"
                ? Math.max(0, base - base * (Number(r.discount_value) || 0) / 100)
                : Math.max(0, base - (Number(r.discount_value) || 0));
              price += unit * r.qty;
            }
            return (
              <button key={b.id} onClick={() => addBundle(b)}
                className="text-left rounded-lg border-2 border-primary/40 bg-card hover:bg-accent active:scale-[0.98] transition-all p-3 min-h-[88px] touch-manipulation">
                <div className="flex items-center gap-1 text-[10px] font-medium text-primary uppercase tracking-wide">
                  <Package className="h-3 w-3" /> Bundle
                </div>
                <div className="font-medium leading-tight mt-1">{b.name}</div>
                {b.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{b.description}</div>}
                <div className="mt-2 font-display text-lg text-primary">₱{fmt(price)}</div>
              </button>
            );
          })
        ) : (
          filtered.map((it) => {
            const vs = itemVariants(it.id);
            const fromPrice = vs.length > 0 ? Math.min(...vs.map((v) => Number(v.price))) : Number(it.price);
            return (
              <button key={it.id} onClick={() => tap(it)}
                className="text-left rounded-lg border bg-card hover:bg-accent active:scale-[0.98] transition-all p-3 min-h-[88px] touch-manipulation">
                <div className="font-medium leading-tight">{it.name}</div>
                {it.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.description}</div>}
                <div className="mt-2 font-display text-lg text-primary">
                  {vs.length > 0 ? `${fmt(fromPrice)}+` : fmt(fromPrice)}
                </div>
              </button>
            );
          })
        )}
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-card border-t shadow-lg p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2 max-h-[60vh] flex flex-col">
          <div className="flex items-center gap-2">
            <Badge>{cart.reduce((n,l) => n + l.qty, 0)} items</Badge>
            <div className="ml-auto font-display text-xl text-primary">₱{fmt(cartSubtotal)}</div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {cart.map((l) => {
              const desc = describeCustom(l.customization);
              return (
                <div key={l.lineId} className="flex items-center gap-2 text-sm border rounded p-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {l.kind === "bundle" && <Package className="h-3 w-3 inline mr-1 text-primary" />}
                      {l.name}
                    </div>
                    <div className="text-xs text-muted-foreground">{fmt(l.unit_price)} × {l.qty}</div>
                    {desc.length > 0 && <div className="text-[11px] text-muted-foreground">{desc.join(" · ")}</div>}
                  </div>
                  <Button size="icon" variant="outline" className="h-7 w-7"
                    onClick={() => setCart((c) => c.map((x) => x.lineId === l.lineId ? { ...x, qty: x.qty - 1 } : x).filter((x) => x.qty > 0))}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-5 text-center">{l.qty}</span>
                  <Button size="icon" variant="outline" className="h-7 w-7"
                    onClick={() => setCart((c) => c.map((x) => x.lineId === l.lineId ? { ...x, qty: x.qty + 1 } : x))}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    onClick={() => setCart((c) => c.filter((x) => x.lineId !== l.lineId))}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
          <Button className="w-full" disabled={placing} onClick={place}>
            {placing ? "Placing…" : `Place order — Pay at counter (₱${fmt(cartSubtotal)})`}
          </Button>
        </div>
      )}

      {customizing && (
        <CustomizeDialog
          open onOpenChange={(o) => !o && setCustomizing(null)}
          itemName={customizing.name} basePrice={Number(customizing.price)}
          options={customizing.options ?? {}}
          variants={customizingVariants}
          hideOther
          onConfirm={(res) => {
            const it = customizing;
            addCustom(it, res);
            setCustomizing(null);
            maybeOfferUpsell(it, cart);
          }}
        />
      )}

      {upsell && (
        <UpsellDialog
          open
          onOpenChange={(o) => !o && setUpsell(null)}
          triggerName={upsell.trigger}
          suggestions={upsell.suggestions}
          onSkip={() => {
            void (supabase as any).rpc("log_upsell_event", {
              p_source: "customer",
              p_suggestions_count: upsell?.suggestions.length ?? 0,
              p_added_count: 0,
            });
            setUpsell(null);
          }}
          onAdd={(picked) => {
            for (const p of picked) {
              const it = items.find((x) => x.id === p.id);
              if (!it) continue;
              // Add plain (no customization) — matches simple tap flow
              setCart((c) => {
                const f = c.find((l) =>
                  l.kind === "item" && l.menu_item_id === it.id
                  && !l.customization && !l.notes && !l.variant_id);
                if (f) return c.map((l) => l.lineId === f.lineId ? { ...l, qty: l.qty + 1 } : l);
                return [...c, {
                  lineId: newId(), kind: "item",
                  menu_item_id: it.id, bundle_id: null, name: it.name,
                  unit_price: Number(it.price), qty: 1, addon_total: 0,
                  customization: null, notes: null, variant_id: null,
                }];
              });
            }
            void (supabase as any).rpc("log_upsell_event", {
              p_source: "customer",
              p_suggestions_count: upsell?.suggestions.length ?? 0,
              p_added_count: picked.length,
            });
            setUpsell(null);
          }}
        />
      )}
    </div>
  );
}
