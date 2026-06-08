import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Star } from "lucide-react";
import {
  type MenuOptions, type PriceOption, type OptionGroup,
} from "@/lib/menu-options";

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
        <Input className="flex-1 h-8" placeholder="Label"
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

function GroupEditor({
  group, onChange, onRemove,
}: {
  group: OptionGroup;
  onChange: (next: OptionGroup) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border rounded p-3 space-y-2 bg-muted/20">
      <div className="flex items-center gap-2">
        <Input className="flex-1 h-8" placeholder="Group name (e.g. Sauce, Topping, Pack)"
          value={group.name}
          onChange={(e) => onChange({ ...group, name: e.target.value })} />
        <Select value={group.select}
          onValueChange={(v) => onChange({ ...group, select: v as "single" | "multi" })}>
          <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Pick one</SelectItem>
            <SelectItem value="multi">Pick any</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs">
          <Switch checked={!!group.required}
            onCheckedChange={(b) => onChange({ ...group, required: b })} />
          Required
        </label>
        <Button size="icon" variant="ghost" className="text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <OptionList title="Choices" items={group.options}
        onChange={(items) => onChange({ ...group, options: items })} />
    </div>
  );
}

export function MenuOptionsEditor({
  value, onChange,
}: { value: MenuOptions; onChange: (v: MenuOptions) => void }) {
  const v = value ?? {};
  const set = (patch: Partial<MenuOptions>) => onChange({ ...v, ...patch });
  const groups = v.groups ?? [];

  function addGroup() {
    set({ groups: [...groups, { name: "", select: "single", required: false, options: [] }] });
  }
  function updateGroup(i: number, next: OptionGroup) {
    set({ groups: groups.map((g, k) => k === i ? next : g) });
  }
  function removeGroup(i: number) {
    set({ groups: groups.filter((_, k) => k !== i) });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Configure choices the customer picks. Prices add to the base price.
      </p>

      {/* Variant heading label — generalize "Size" */}
      <div className="border rounded p-3 space-y-2">
        <div className="text-sm font-medium">Variant group heading</div>
        <div className="text-xs text-muted-foreground">
          Label shown above the variant picker (e.g. "Size", "Color", "Pack").
        </div>
        <Input value={v.variant_group_label ?? ""}
          placeholder="Variant"
          onChange={(e) => set({ variant_group_label: e.target.value })} />
      </div>

      {/* NEW: fully dynamic groups (admin-named) */}
      <div className="border rounded p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Custom option groups</div>
            <div className="text-xs text-muted-foreground">
              Add any number of named groups (e.g. Sauce, Toppings, Crust). Each can be single or multi-select.
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={addGroup}>
            <Plus className="h-3 w-3 mr-1" /> Add group
          </Button>
        </div>
        {groups.length === 0 ? (
          <div className="text-xs text-muted-foreground py-1">No custom groups.</div>
        ) : (
          <div className="space-y-2">
            {groups.map((g, i) => (
              <GroupEditor key={i} group={g}
                onChange={(n) => updateGroup(i, n)}
                onRemove={() => removeGroup(i)} />
            ))}
          </div>
        )}
      </div>

      {/* Legacy buckets — kept for backward compat */}
      <details className="border rounded p-3">
        <summary className="text-sm font-medium cursor-pointer">Legacy presets (sizes, milks, extras…)</summary>
        <div className="space-y-3 mt-3">
          <OptionList title="Sizes"
            hint="Click the star to set default."
            items={v.sizes ?? []} allowDefault
            onChange={(next) => set({ sizes: next })} />
          <div className="flex items-center gap-2 pl-1">
            <Switch checked={!!v.size_required}
              onCheckedChange={(b) => set({ size_required: b })} />
            <span className="text-xs">Size is required at POS</span>
          </div>
          <OptionList title="Milk options" items={v.milks ?? []}
            onChange={(next) => set({ milks: next })} />
          <OptionList title="Extras" items={v.extras ?? []}
            onChange={(next) => set({ extras: next })} />
          <OptionList title="Flavors" items={v.flavors ?? []}
            onChange={(next) => set({ flavors: next })} />
          <OptionList title="Others" items={v.others ?? []}
            onChange={(next) => set({ others: next })} />
        </div>
      </details>

      <div className="border rounded p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Allow "Other" custom add-on (POS only)</div>
            <div className="text-xs text-muted-foreground">
              Cashier types a name + price not on the list. Hidden on the customer ordering page.
            </div>
          </div>
          <Switch checked={!!v.allow_other} onCheckedChange={(b) => set({ allow_other: b })} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Allow special instructions</div>
            <div className="text-xs text-muted-foreground">Free-text note.</div>
          </div>
          <Switch checked={v.allow_notes !== false} onCheckedChange={(b) => set({ allow_notes: b })} />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Tip: use Custom option groups for new menus — they work for any business type.
      </div>
    </div>
  );
}
