import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
import {
  type MenuOptions, type SelectedCustom, type PriceOption,
  addonTotal,
} from "@/lib/menu-options";

const fmt = (n: number) => n.toFixed(2);

export function CustomizeDialog({
  open, onOpenChange, itemName, basePrice, options, onConfirm,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemName: string;
  basePrice: number;
  options: MenuOptions;
  initial?: { custom: SelectedCustom | null; qty: number; notes: string };
  onConfirm: (sel: { custom: SelectedCustom; addon: number; qty: number; notes: string }) => void;
}) {
  const defSize = useMemo(
    () => options.sizes?.find((s) => s.is_default) ?? options.sizes?.[0] ?? null,
    [options.sizes],
  );
  const [size, setSize] = useState<PriceOption | null>(null);
  const [milk, setMilk] = useState<PriceOption | null>(null);
  const [extras, setExtras] = useState<PriceOption[]>([]);
  const [other, setOther] = useState<PriceOption[]>([]);
  const [otherLabel, setOtherLabel] = useState("");
  const [otherPrice, setOtherPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setSize(initial?.custom?.size ?? defSize);
    setMilk(initial?.custom?.milk ?? null);
    setExtras(initial?.custom?.extras ?? []);
    setOther(initial?.custom?.other ?? []);
    setOtherLabel(""); setOtherPrice("");
    setQty(initial?.qty ?? 1);
    setNotes(initial?.notes ?? "");
  }, [open, initial, defSize]);

  const sel: SelectedCustom = {
    size: size ?? undefined,
    milk: milk ?? undefined,
    extras: extras.length ? extras : undefined,
    other: other.length ? other : undefined,
  };
  const addon = addonTotal(sel);
  const unit = Number(basePrice) + addon;
  const sizes = options.sizes ?? [];
  const milks = options.milks ?? [];
  const exs = options.extras ?? [];
  const sizeRequired = !!options.size_required && sizes.length > 0;

  function toggleExtra(o: PriceOption) {
    setExtras((cur) => cur.some((x) => x.label === o.label)
      ? cur.filter((x) => x.label !== o.label)
      : [...cur, o]);
  }

  function addOther() {
    const lbl = otherLabel.trim();
    const p = Number(otherPrice);
    if (!lbl) return;
    setOther((cur) => [...cur, { label: lbl, price_delta: isFinite(p) ? p : 0 }]);
    setOtherLabel(""); setOtherPrice("");
  }

  function confirm() {
    onConfirm({ custom: sel, addon, qty: Math.max(1, qty), notes: notes.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{itemName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {sizes.length > 0 && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Size {sizeRequired && <span className="text-destructive">*</span>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {sizes.map((s) => (
                  <button key={s.label}
                    onClick={() => setSize(s)}
                    className={`rounded-md border p-2 text-left transition-colors ${
                      size?.label === s.label ? "border-primary bg-primary/10" : "hover:bg-accent"
                    }`}>
                    <div className="font-medium leading-tight">{s.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.price_delta > 0 ? `+${fmt(s.price_delta)}` : s.price_delta < 0 ? fmt(s.price_delta) : "base"}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {milks.length > 0 && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">Milk</div>
              <div className="grid grid-cols-2 gap-2">
                {milks.map((m) => (
                  <button key={m.label}
                    onClick={() => setMilk(milk?.label === m.label ? null : m)}
                    className={`rounded-md border p-2 text-left transition-colors ${
                      milk?.label === m.label ? "border-primary bg-primary/10" : "hover:bg-accent"
                    }`}>
                    <div className="font-medium leading-tight">{m.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.price_delta > 0 ? `+${fmt(m.price_delta)}` : "free"}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {exs.length > 0 && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">Extras</div>
              <div className="space-y-1">
                {exs.map((e) => {
                  const on = extras.some((x) => x.label === e.label);
                  return (
                    <label key={e.label} className="flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent">
                      <Checkbox checked={on} onCheckedChange={() => toggleExtra(e)} />
                      <span className="flex-1">{e.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {e.price_delta > 0 ? `+${fmt(e.price_delta)}` : "free"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {options.allow_other && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">Other</div>
              {other.length > 0 && (
                <div className="space-y-1 mb-2">
                  {other.map((o, i) => (
                    <div key={i} className="flex items-center gap-2 rounded border p-2 text-sm">
                      <span className="flex-1">{o.label}</span>
                      <span className="text-xs text-muted-foreground">+{fmt(o.price_delta)}</span>
                      <Button size="icon" variant="ghost"
                        onClick={() => setOther((cur) => cur.filter((_, k) => k !== i))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input placeholder="Name" value={otherLabel}
                  onChange={(e) => setOtherLabel(e.target.value)} />
                <Input type="number" placeholder="Price" className="w-24" value={otherPrice}
                  onChange={(e) => setOtherPrice(e.target.value)} />
                <Button variant="outline" size="sm" onClick={addOther}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </section>
          )}

          {options.allow_notes && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">Special instructions</div>
              <Textarea rows={2} placeholder="e.g. less ice, no sugar"
                value={notes} onChange={(e) => setNotes(e.target.value)} />
            </section>
          )}

          <section className="flex items-center justify-between border-t pt-3">
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</Button>
              <span className="w-8 text-center font-medium">{qty}</span>
              <Button size="icon" variant="outline" onClick={() => setQty((q) => q + 1)}>+</Button>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Unit price</div>
              <div className="font-display text-lg text-primary">{fmt(unit)}</div>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={confirm} disabled={sizeRequired && !size}>
            Add — {fmt(unit * Math.max(1, qty))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
