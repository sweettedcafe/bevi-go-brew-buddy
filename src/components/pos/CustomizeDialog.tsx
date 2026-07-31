import { useEffect, useMemo, useRef, useState } from "react";
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

export type VariantChoice = {
  id: string;
  name: string;
  price: number;
  sort_order?: number;
};

export function CustomizeDialog({
  open, onOpenChange, itemName, basePrice, options, onConfirm,
  initial, variants, hideOther = false, imageUrl, onImageClick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemName: string;
  basePrice: number;
  options: MenuOptions;
  variants?: VariantChoice[];
  initial?: { custom: SelectedCustom | null; qty: number; notes: string; variantId?: string | null };
  hideOther?: boolean;          // NEW — customer self-order should hide free-form price input
  imageUrl?: string | null;
  onImageClick?: () => void;
  onConfirm: (sel: {
    custom: SelectedCustom; addon: number; qty: number; notes: string;
    variant: VariantChoice | null;
  }) => void;
}) {
  const defSize = useMemo(
    () => options.sizes?.find((s) => s.is_default) ?? options.sizes?.[0] ?? null,
    [options.sizes],
  );
  const sortedVariants = useMemo(
    () => (variants ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [variants],
  );
  const hasVariants = sortedVariants.length > 0;
  const variantHeading = (options.variant_group_label?.trim() || "Variant");
  const dynGroups = options.groups ?? [];

  const [variantId, setVariantId] = useState<string | null>(null);
  const [size, setSize] = useState<PriceOption | null>(null);
  const [milk, setMilk] = useState<PriceOption | null>(null);
  const [extras, setExtras] = useState<PriceOption[]>([]);
  const [flavors, setFlavors] = useState<PriceOption[]>([]);
  const [others, setOthers] = useState<PriceOption[]>([]);
  const [other, setOther] = useState<PriceOption[]>([]);
  const [groupSel, setGroupSel] = useState<Record<string, PriceOption[]>>({});
  const [otherLabel, setOtherLabel] = useState("");
  const [otherPrice, setOtherPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  // Keep latest values without making them effect dependencies — callers often
  // pass freshly-built arrays/objects, which would otherwise re-run this reset
  // on every render and cause an infinite update loop.
  const latest = useRef({ initial, defSize, sortedVariants });
  latest.current = { initial, defSize, sortedVariants };
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const { initial: init, defSize: ds, sortedVariants: sv } = latest.current;
    setVariantId(init?.variantId ?? sv[0]?.id ?? null);
    setSize(init?.custom?.size ?? ds);
    setMilk(init?.custom?.milk ?? null);
    setExtras(init?.custom?.extras ?? []);
    setFlavors(init?.custom?.flavors ?? []);
    setOthers(init?.custom?.others ?? []);
    setOther(init?.custom?.other ?? []);
    setGroupSel(init?.custom?.groups ?? {});
    setOtherLabel(""); setOtherPrice("");
    setQty(init?.qty ?? 1);
    setNotes(init?.notes ?? "");
  }, [open]);


  const selectedVariant = hasVariants
    ? (sortedVariants.find((v) => v.id === variantId) ?? null)
    : null;

  const sel: SelectedCustom = {
    size: size ?? undefined,
    milk: milk ?? undefined,
    extras: extras.length ? extras : undefined,
    flavors: flavors.length ? flavors : undefined,
    others: others.length ? others : undefined,
    other: other.length ? other : undefined,
    groups: Object.keys(groupSel).length ? groupSel : undefined,
  };
  const addon = addonTotal(sel);
  const base = selectedVariant ? Number(selectedVariant.price) : Number(basePrice);
  const unit = base + addon;
  const sizes = options.sizes ?? [];
  const milks = options.milks ?? [];
  const exs = options.extras ?? [];
  const flvs = options.flavors ?? [];
  const oths = options.others ?? [];
  const sizeRequired = !!options.size_required && sizes.length > 0;

  function toggleIn(list: PriceOption[], setList: (n: PriceOption[]) => void, o: PriceOption) {
    setList(list.some((x) => x.label === o.label) ? list.filter((x) => x.label !== o.label) : [...list, o]);
  }
  function toggleExtra(o: PriceOption) { toggleIn(extras, setExtras, o); }

  function pickGroup(groupName: string, mode: "single" | "multi", opt: PriceOption) {
    setGroupSel((cur) => {
      const list = cur[groupName] ?? [];
      const has = list.some((x) => x.label === opt.label);
      let next: PriceOption[];
      if (mode === "single") next = has ? [] : [opt];
      else next = has ? list.filter((x) => x.label !== opt.label) : [...list, opt];
      const out = { ...cur };
      if (next.length === 0) delete out[groupName]; else out[groupName] = next;
      return out;
    });
  }

  function addOther() {
    const lbl = otherLabel.trim();
    const p = Number(otherPrice);
    if (!lbl) return;
    setOther((cur) => [...cur, { label: lbl, price_delta: isFinite(p) ? p : 0 }]);
    setOtherLabel(""); setOtherPrice("");
  }

  function confirm() {
    onConfirm({
      custom: sel, addon, qty: Math.max(1, qty), notes: notes.trim(),
      variant: selectedVariant,
    });
  }

  const groupMissing = dynGroups.some(
    (g) => g.required && !(groupSel[g.name]?.length),
  );
  const disabled =
    (sizeRequired && !size) || (hasVariants && !selectedVariant) || groupMissing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{itemName}</DialogTitle>
        </DialogHeader>

        {imageUrl && (
          <button
            type="button"
            onClick={onImageClick}
            className="-mt-1 block w-full overflow-hidden rounded-lg border bg-muted text-left"
            aria-label={`View ${itemName} image`}
          >
            <img src={imageUrl} alt={itemName} className="h-44 w-full object-cover" loading="lazy" />
          </button>
        )}

        <div className="space-y-4 text-sm">
          {hasVariants && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                {variantHeading} <span className="text-destructive">*</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {sortedVariants.map((v) => (
                  <button key={v.id}
                    onClick={() => setVariantId(v.id)}
                    className={`rounded-md border p-2 text-left transition-colors ${
                      variantId === v.id ? "border-primary bg-primary/10" : "hover:bg-accent"
                    }`}>
                    <div className="font-medium leading-tight">{v.name}</div>
                    <div className="text-xs text-muted-foreground">{fmt(Number(v.price))}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!hasVariants && sizes.length > 0 && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                {variantHeading} {sizeRequired && <span className="text-destructive">*</span>}
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

          {flvs.length > 0 && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">Flavors</div>
              <div className="space-y-1">
                {flvs.map((e) => {
                  const on = flavors.some((x) => x.label === e.label);
                  return (
                    <label key={e.label} className="flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent">
                      <Checkbox checked={on} onCheckedChange={() => toggleIn(flavors, setFlavors, e)} />
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

          {oths.length > 0 && (
            <section>
              <div className="text-xs font-medium text-muted-foreground mb-2">Others</div>
              <div className="space-y-1">
                {oths.map((e) => {
                  const on = others.some((x) => x.label === e.label);
                  return (
                    <label key={e.label} className="flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent">
                      <Checkbox checked={on} onCheckedChange={() => toggleIn(others, setOthers, e)} />
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

          {/* NEW: dynamic admin-defined groups */}
          {dynGroups.map((g) => {
            const list = groupSel[g.name] ?? [];
            return (
              <section key={g.name}>
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  {g.name}
                  {g.required && <span className="text-destructive"> *</span>}
                  <span className="ml-1 text-[10px] uppercase opacity-60">
                    {g.select === "single" ? "pick one" : "pick any"}
                  </span>
                </div>
                <div className="space-y-1">
                  {g.options.map((opt) => {
                    const on = list.some((x) => x.label === opt.label);
                    return (
                      <label key={opt.label}
                        className={`flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent ${on ? "border-primary bg-primary/10" : ""}`}>
                        <Checkbox checked={on} onCheckedChange={() => pickGroup(g.name, g.select, opt)} />
                        <span className="flex-1">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {opt.price_delta > 0 ? `+${fmt(opt.price_delta)}` : opt.price_delta < 0 ? fmt(opt.price_delta) : "free"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {options.allow_other && !hideOther && (
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
          <Button onClick={confirm} disabled={disabled}>
            Add — {fmt(unit * Math.max(1, qty))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
