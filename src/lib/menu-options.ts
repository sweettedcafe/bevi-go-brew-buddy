// Shared menu customization types & helpers
export type PriceOption = { label: string; price_delta: number; is_default?: boolean };

// NEW: fully dynamic group (admin-named, single- or multi-select)
export type OptionGroup = {
  name: string;                 // user-facing label (e.g. "Sauce", "Toppings")
  select: "single" | "multi";
  required?: boolean;
  options: PriceOption[];
};

export type MenuOptions = {
  // Legacy buckets (still supported)
  sizes?: PriceOption[];
  milks?: PriceOption[];
  extras?: PriceOption[];
  flavors?: PriceOption[];
  others?: PriceOption[];
  allow_other?: boolean;
  allow_notes?: boolean;
  size_required?: boolean;
  // NEW: generalize "Size" heading and add dynamic groups
  variant_group_label?: string; // e.g. "Color", "Pack"
  groups?: OptionGroup[];
  // NEW: upsell suggestions — menu item ids to recommend alongside this item
  upsell_item_ids?: string[];
};

export type SelectedCustom = {
  size?: PriceOption;
  milk?: PriceOption;
  extras?: PriceOption[];
  flavors?: PriceOption[];
  others?: PriceOption[];
  other?: PriceOption[];
  // NEW: dynamic groups, keyed by group name
  groups?: Record<string, PriceOption[]>;
};

export function emptyOptions(): MenuOptions {
  return {
    sizes: [],
    milks: [],
    extras: [],
    flavors: [],
    others: [],
    allow_other: false,
    allow_notes: true,
    size_required: false,
    groups: [],
  };
}

export function hasAnyCustomization(o: MenuOptions | null | undefined): boolean {
  if (!o) return false;
  return !!(
    (o.sizes && o.sizes.length > 0) ||
    (o.milks && o.milks.length > 0) ||
    (o.extras && o.extras.length > 0) ||
    (o.flavors && o.flavors.length > 0) ||
    (o.others && o.others.length > 0) ||
    (o.groups && o.groups.length > 0) ||
    o.allow_other ||
    o.allow_notes
  );
}

export function addonTotal(c: SelectedCustom | null | undefined): number {
  if (!c) return 0;
  let t = 0;
  if (c.size) t += Number(c.size.price_delta) || 0;
  if (c.milk) t += Number(c.milk.price_delta) || 0;
  for (const e of c.extras ?? []) t += Number(e.price_delta) || 0;
  for (const e of c.flavors ?? []) t += Number(e.price_delta) || 0;
  for (const e of c.others ?? []) t += Number(e.price_delta) || 0;
  for (const e of c.other ?? []) t += Number(e.price_delta) || 0;
  for (const list of Object.values(c.groups ?? {})) {
    for (const e of list) t += Number(e.price_delta) || 0;
  }
  return Math.round(t * 100) / 100;
}

export function customSignature(c: SelectedCustom | null | undefined, notes?: string | null): string {
  if (!c && !notes) return "";
  const parts: string[] = [];
  if (c?.size) parts.push(`S:${c.size.label}`);
  if (c?.milk) parts.push(`M:${c.milk.label}`);
  for (const e of c?.extras ?? []) parts.push(`E:${e.label}`);
  for (const e of c?.flavors ?? []) parts.push(`F:${e.label}`);
  for (const e of c?.others ?? []) parts.push(`X:${e.label}`);
  for (const e of c?.other ?? []) parts.push(`O:${e.label}:${e.price_delta}`);
  for (const [g, list] of Object.entries(c?.groups ?? {})) {
    for (const e of list) parts.push(`G:${g}:${e.label}`);
  }
  if (notes) parts.push(`N:${notes.trim()}`);
  return parts.join("|");
}

export function describeCustom(c: SelectedCustom | null | undefined): string[] {
  const lines: string[] = [];
  if (!c) return lines;
  if (c.size) lines.push(c.size.label);
  if (c.milk) lines.push(`${c.milk.label} milk`);
  for (const e of c.extras ?? []) lines.push(`+ ${e.label}`);
  for (const e of c.flavors ?? []) lines.push(`+ ${e.label}`);
  for (const e of c.others ?? []) lines.push(`+ ${e.label}`);
  for (const e of c.other ?? []) lines.push(`+ ${e.label}`);
  for (const [g, list] of Object.entries(c.groups ?? {})) {
    for (const e of list) lines.push(`${g}: ${e.label}`);
  }
  return lines;
}
