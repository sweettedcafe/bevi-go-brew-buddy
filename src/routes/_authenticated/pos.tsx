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
import { Trash2, Plus, Minus, ShoppingCart, Coffee, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pos")({
  component: POSPage,
});

type Category = { id: string; name: string; sort_order: number };
type MenuItem = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
  sort_order: number;
};
type CartLine = { menu_item_id: string; name: string; unit_price: number; qty: number };
type OrderType = "dine_in" | "takeout" | "delivery";
type PayMethod = "cash" | "card" | "transfer";

function fmt(n: number) {
  return n.toFixed(2);
}

function POSPage() {
  const { user, primaryRole, roleError } = useAuth();
  const [cats, setCats] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("takeout");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: c }, { data: m }] = await Promise.all([
        supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("menu_items").select("*").eq("is_active", true).order("sort_order"),
      ]);
      if (!alive) return;
      setCats((c ?? []) as Category[]);
      setItems((m ?? []) as MenuItem[]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
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

  function addItem(it: MenuItem) {
    setCart((c) => {
      const found = c.find((l) => l.menu_item_id === it.id);
      if (found) {
        return c.map((l) =>
          l.menu_item_id === it.id ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [...c, { menu_item_id: it.id, name: it.name, unit_price: Number(it.price), qty: 1 }];
    });
  }
  function changeQty(id: string, delta: number) {
    setCart((c) =>
      c
        .map((l) => (l.menu_item_id === id ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }
  function removeLine(id: string) {
    setCart((c) => c.filter((l) => l.menu_item_id !== id));
  }
  function clearCart() {
    setCart([]);
    setCustomerName("");
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
    <div className="h-screen flex bg-background">
      {/* Menu side */}
      <section className="flex-1 flex flex-col min-w-0">
        <header className="px-6 py-4 border-b bg-card flex items-center gap-4">
          <Coffee className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-display">Point of Sale</h1>
          <div className="ml-auto relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search menu…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </header>

        <div className="px-6 py-3 border-b bg-card flex gap-2 overflow-x-auto">
          <Button
            size="sm"
            variant={activeCat === "all" ? "default" : "outline"}
            onClick={() => setActiveCat("all")}
          >
            All
          </Button>
          {cats.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={activeCat === c.id ? "default" : "outline"}
              onClick={() => setActiveCat(c.id)}
            >
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
                <button
                  key={it.id}
                  onClick={() => addItem(it)}
                  className="text-left rounded-lg border bg-card hover:bg-accent hover:border-primary/50 transition-colors p-4 shadow-sm"
                >
                  <div className="font-medium leading-tight">{it.name}</div>
                  {it.description && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {it.description}
                    </div>
                  )}
                  <div className="mt-3 font-display text-lg text-primary">
                    {fmt(Number(it.price))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Cart side */}
      <aside className="w-[380px] border-l bg-card flex flex-col">
        <div className="p-4 border-b flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" />
          <h2 className="font-display text-lg">Current Order</h2>
          <Badge variant="secondary" className="ml-auto">
            {cart.reduce((n, l) => n + l.qty, 0)} items
          </Badge>
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
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Ahmed"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {cart.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-10">
              Tap a menu item to add it.
            </div>
          ) : (
            cart.map((l) => (
              <Card key={l.menu_item_id} className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmt(l.unit_price)} × {l.qty} = {fmt(l.unit_price * l.qty)}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeLine(l.menu_item_id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button size="icon" variant="outline" onClick={() => changeQty(l.menu_item_id, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-8 text-center font-medium">{l.qty}</span>
                  <Button size="icon" variant="outline" onClick={() => changeQty(l.menu_item_id, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="p-4 border-t space-y-3 bg-card">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between font-display text-xl">
            <span>Total</span>
            <span className="text-primary">{fmt(subtotal)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={clearCart} disabled={cart.length === 0}>
              Clear
            </Button>
            <Button onClick={() => setCheckoutOpen(true)} disabled={cart.length === 0}>
              Charge
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground text-center">
            Cashier: {user?.email}
          </div>
        </div>
      </aside>

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        total={subtotal}
        onConfirm={async (method, amount) => {
          const payload = {
            order_type: orderType,
            customer_name: customerName || null,
            notes: null,
            items: cart.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty })),
            payments: [
              {
                method,
                amount,
                change_due: method === "cash" ? Math.max(0, amount - subtotal) : 0,
                reference: null,
              },
            ],
          };
          const { data, error } = await supabase.rpc("pos_create_order", { p_payload: payload });
          if (error) {
            toast.error(`Order failed: ${error.message}`);
            return false;
          }
          const result = data as { order_no: number; total: number };
          toast.success(`Order #${String(result.order_no).padStart(3, "0")} completed`);
          clearCart();
          setCheckoutOpen(false);
          return true;
        }}
      />
    </div>
  );
}

function CheckoutDialog({
  open, onOpenChange, total, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  total: number;
  onConfirm: (method: PayMethod, amount: number) => Promise<boolean>;
}) {
  const [method, setMethod] = useState<PayMethod>("cash");
  const [tendered, setTendered] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTendered(total.toFixed(2));
      setMethod("cash");
    }
  }, [open, total]);

  const tenderedNum = Number(tendered) || 0;
  const change = method === "cash" ? Math.max(0, tenderedNum - total) : 0;
  const short = method === "cash" && tenderedNum < total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-between font-display text-2xl">
            <span>Total due</span>
            <span className="text-primary">{total.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(["cash", "card", "transfer"] as PayMethod[]).map((m) => (
              <Button
                key={m}
                variant={method === m ? "default" : "outline"}
                onClick={() => setMethod(m)}
                className="capitalize"
              >
                {m}
              </Button>
            ))}
          </div>

          {method === "cash" && (
            <div>
              <label className="text-xs text-muted-foreground">Cash received</label>
              <Input
                type="number"
                inputMode="decimal"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
              />
              <div className="grid grid-cols-4 gap-2 mt-2">
                {[total, Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50].map(
                  (v, i) => (
                    <Button key={i} size="sm" variant="outline" onClick={() => setTendered(v.toFixed(2))}>
                      {v.toFixed(2)}
                    </Button>
                  ),
                )}
              </div>
              <div className="flex justify-between mt-3 text-sm">
                <span className="text-muted-foreground">Change</span>
                <span className={short ? "text-destructive" : ""}>
                  {short ? `Short ${(total - tenderedNum).toFixed(2)}` : change.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={submitting || (method === "cash" && short)}
            onClick={async () => {
              setSubmitting(true);
              const amount = method === "cash" ? tenderedNum : total;
              await onConfirm(method, amount);
              setSubmitting(false);
            }}
          >
            {submitting ? "Processing…" : "Confirm Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
