import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coffee, Plus, Minus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CustomizeDialog } from "@/components/pos/CustomizeDialog";
import {
  type MenuOptions, type SelectedCustom,
  hasAnyCustomization, customSignature, describeCustom,
} from "@/lib/menu-options";

export const Route = createFileRoute("/o/$token")({ component: SelfOrderPage });

const db = supabase as any;
const fmt = (n: number) => n.toFixed(2);

type Item = { id: string; category_id: string | null; name: string; description: string | null; price: number; options: MenuOptions | null };
type Cat = { id: string; name: string; sort_order: number };
type CartLine = {
  lineId: string; menu_item_id: string; name: string;
  unit_price: number; qty: number; addon_total: number;
  customization: SelectedCustom | null; notes: string | null;
};

function SelfOrderPage() {
  const { token } = Route.useParams();
  const [customer, setCustomer] = useState<{ id: string; name: string; points: number } | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [activeCat, setActiveCat] = useState<string | "all">("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [done, setDone] = useState<{ order_no: number; total: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: m }] = await Promise.all([
        db.rpc("customer_by_token", { p_token: token }),
        db.rpc("public_menu"),
      ]);
      if (!c) { toast.error("Invalid or expired QR code"); setLoading(false); return; }
      setCustomer(c as any);
      setCats(((m as any)?.categories ?? []) as Cat[]);
      setItems(((m as any)?.items ?? []) as Item[]);
      setLoading(false);
    })();
  }, [token]);

  const filtered = useMemo(
    () => items.filter((i) => activeCat === "all" || i.category_id === activeCat),
    [items, activeCat],
  );
  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);

  function newId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }

  function tap(it: Item) {
    if (hasAnyCustomization(it.options)) { setCustomizing(it); return; }
    setCart((c) => {
      const f = c.find((l) => l.menu_item_id === it.id && !l.customization && !l.notes);
      if (f) return c.map((l) => l.lineId === f.lineId ? { ...l, qty: l.qty + 1 } : l);
      return [...c, { lineId: newId(), menu_item_id: it.id, name: it.name,
        unit_price: Number(it.price), qty: 1, addon_total: 0,
        customization: null, notes: null }];
    });
  }

  function addCustom(it: Item, res: { custom: SelectedCustom; addon: number; qty: number; notes: string }) {
    const unit = Number(it.price) + res.addon;
    const notes = res.notes.trim() || null;
    setCart((c) => {
      const sig = customSignature(res.custom, notes);
      const dup = c.find((l) => l.menu_item_id === it.id && customSignature(l.customization, l.notes) === sig);
      if (dup) return c.map((l) => l.lineId === dup.lineId ? { ...l, qty: l.qty + res.qty } : l);
      return [...c, { lineId: newId(), menu_item_id: it.id, name: it.name,
        unit_price: unit, qty: res.qty, addon_total: res.addon,
        customization: res.custom, notes }];
    });
  }

  async function place() {
    if (cart.length === 0) return;
    setPlacing(true);
    const { data, error } = await db.rpc("customer_self_order", {
      p_token: token,
      p_payload: {
        order_type: "takeout",
        items: cart.map((l) => ({
          menu_item_id: l.menu_item_id, qty: l.qty,
          addon_total: l.addon_total, customization: l.customization, notes: l.notes,
        })),
      },
    });
    setPlacing(false);
    if (error) { toast.error(error.message); return; }
    const r = data as any;
    setDone({ order_no: r.order_no, total: Number(r.total) });
    setCart([]);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (!customer) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground p-6 text-center">Sorry, this QR is no longer valid. Please ask the barista to issue a new one.</div>;

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full p-6 text-center space-y-3">
          <Coffee className="h-8 w-8 text-primary mx-auto" />
          <h1 className="font-display text-2xl">Order placed!</h1>
          <div className="text-sm text-muted-foreground">Show this number at the counter to pay.</div>
          <div className="font-display text-5xl text-primary">#{String(done.order_no).padStart(3,"0")}</div>
          <div className="text-lg">Total ₱{fmt(done.total)}</div>
          <div className="text-xs text-muted-foreground">Pay with cash at the counter — the barista will complete your order.</div>
          <Button className="w-full" onClick={() => setDone(null)}>Order again</Button>
        </Card>
      </div>
    );
  }

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
        {cats.map((c) => (
          <Button key={c.id} size="sm" variant={activeCat === c.id ? "default" : "outline"} onClick={() => setActiveCat(c.id)}>{c.name}</Button>
        ))}
      </div>

      <div className="p-3 grid grid-cols-2 gap-2 pb-48">
        {filtered.map((it) => (
          <button key={it.id} onClick={() => tap(it)}
            className="text-left rounded-lg border bg-card hover:bg-accent transition-colors p-3">
            <div className="font-medium leading-tight">{it.name}</div>
            {it.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.description}</div>}
            <div className="mt-2 font-display text-lg text-primary">{fmt(Number(it.price))}</div>
          </button>
        ))}
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-card border-t shadow-lg p-3 space-y-2 max-h-[55vh] flex flex-col">
          <div className="flex items-center gap-2">
            <Badge>{cart.reduce((n,l) => n + l.qty, 0)} items</Badge>
            <div className="ml-auto font-display text-xl text-primary">₱{fmt(subtotal)}</div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {cart.map((l) => {
              const desc = describeCustom(l.customization);
              return (
                <div key={l.lineId} className="flex items-center gap-2 text-sm border rounded p-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
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
            {placing ? "Placing…" : `Place order — Pay at counter (₱${fmt(subtotal)})`}
          </Button>
        </div>
      )}

      {customizing && (
        <CustomizeDialog
          open onOpenChange={(o) => !o && setCustomizing(null)}
          itemName={customizing.name} basePrice={Number(customizing.price)}
          options={customizing.options ?? {}}
          onConfirm={(res) => { addCustom(customizing, res); setCustomizing(null); }}
        />
      )}
    </div>
  );
}
