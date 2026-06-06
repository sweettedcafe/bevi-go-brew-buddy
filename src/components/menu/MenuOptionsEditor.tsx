import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Star } from "lucide-react";
import { type MenuOptions, type PriceOption } from "@/lib/menu-options";

const fmt = (n: number) => Number(n).toFixed(2);

function OptionList({
  title, hint, items, onChange, allowDefault = false,
}: {
  title: string;
  hint?: string;
  items: PriceOption[];
  onChange: (next: PriceOption[]) => void;
  allowDefault?: boolean;
}) {
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState("");

  function add() {
    const l = label.trim();
    if (!l) return;
    const p = Number(price);
    onChange([...items, { label: l, price_delta: isFinite(p) ? p : 0 }]);
    setLabel(""); setPrice("");
  }
  function remove(i: number) { onChange(items.filter((_, k) => k !== i)); }
  function setDefault(i: number) {
    onChange(items.map((x, k) => ({ ...x, is_default: k === i ? true : false })));
  }
  function updateAt(i: number, patch: Partial<PriceOption>) {
    onChange(items.map((x, k) => k === i ? { ...x, ...patch } : x));
  }

  return (
    <div className="border rounded p-3 space-y-2">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="flex-1 h-8" value={x.label}
                onChange={(e) => updateAt(i, { label: e.target.value })} />
              <Input className="w-24 h-8" type="number" value={String(x.price_delta)}
                onChange={(e) => updateAt(i, { price_delta: Number(e.target.value) || 0 })} />
              {allowDefault && (
                <Button size="icon" variant={x.is_default ? "default" : "ghost"}
                  title="Default" onClick={() => setDefault(i)}>
                  <Star className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => remove(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input className="flex-1 h-8" placeholder="Label (e.g. Medium 12oz)"
          value={label} onChange={(e) => setLabel(e.target.value)} />
        <Input className="w-24 h-8" type="number" placeholder="+ price"
          value={price} onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function MenuOptionsEditor({
  value, onChange,
}: { value: MenuOptions; onChange: (v: MenuOptions) => void }) {
  const v = value ?? {};
  const set = (patch: Partial<MenuOptions>) => onChange({ ...v, ...patch });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Configure size, milk, extras and other choices the cashier picks in POS. Prices add to the base price.
      </p>
      <OptionList
        title="Sizes"
        hint="e.g. Small 8oz (+0), Medium 12oz (+20), Large 16oz (+40). Click the star to set default."
        items={v.sizes ?? []} allowDefault
        onChange={(next) => set({ sizes: next })}
      />
      <div className="flex items-center gap-2 pl-1">
        <Switch checked={!!v.size_required}
          onCheckedChange={(b) => set({ size_required: b })} />
        <span className="text-xs">Size is required at POS</span>
      </div>

      <OptionList
        title="Milk options"
        hint="e.g. Whole (0), Oat (+15), Almond (+15), Soy (+15)."
        items={v.milks ?? []}
        onChange={(next) => set({ milks: next })}
      />

      <OptionList
        title="Extras"
        hint="Add-ons like extra shot, syrup, whipped cream."
        items={v.extras ?? []}
        onChange={(next) => set({ extras: next })}
      />

      <div className="border rounded p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Allow "Other" custom add-on</div>
            <div className="text-xs text-muted-foreground">Cashier types a name and price not on the list.</div>
          </div>
          <Switch checked={!!v.allow_other} onCheckedChange={(b) => set({ allow_other: b })} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Allow special instructions</div>
            <div className="text-xs text-muted-foreground">Free-text note from the customer.</div>
          </div>
          <Switch checked={v.allow_notes !== false} onCheckedChange={(b) => set({ allow_notes: b })} />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Preview unit prices vary in POS. Example: base {fmt(0)} + size +20 + oat +15 = +35.
      </div>
    </div>
  );
}
