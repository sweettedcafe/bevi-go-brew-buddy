// Shared menu customization types & helpers
export type PriceOption = { label: string; price_delta: number; is_default?: boolean };
export type MenuOptions = {
  sizes?: PriceOption[];
  milks?: PriceOption[];
  extras?: PriceOption[];
  allow_other?: boolean;
  allow_notes?: boolean;
  size_required?: boolean;
};

export type SelectedCustom = {
  size?: PriceOption;
  milk?: PriceOption;
  extras?: PriceOption[];
  other?: PriceOption[];
};

export function emptyOptions(): MenuOptions {
  return {
    sizes: [],
    milks: [],
    extras: [],
    allow_other: false,
    allow_notes: true,
    size_required: false,
  };
}

export function hasAnyCustomization(o: MenuOptions | null | undefined): boolean {
  if (!o) return false;
  return (
    (o.sizes && o.sizes.length > 0) ||
    (o.milks && o.milks.length > 0) ||
    (o.extras && o.extras.length > 0) ||
    !!o.allow_other ||
    !!o.allow_notes
  ) || false;
}

export function addonTotal(c: SelectedCustom | null | undefined): number {
  if (!c) return 0;
  let t = 0;
  if (c.size) t += Number(c.size.price_delta) || 0;
  if (c.milk) t += Number(c.milk.price_delta) || 0;
  for (const e of c.extras ?? []) t += Number(e.price_delta) || 0;
  for (const e of c.other ?? []) t += Number(e.price_delta) || 0;
  return Math.round(t * 100) / 100;
}

export function customSignature(c: SelectedCustom | null | undefined, notes?: string | null): string {
  if (!c && !notes) return "";
  const parts: string[] = [];
  if (c?.size) parts.push(`S:${c.size.label}`);
  if (c?.milk) parts.push(`M:${c.milk.label}`);
  for (const e of c?.extras ?? []) parts.push(`E:${e.label}`);
  for (const e of c?.other ?? []) parts.push(`O:${e.label}:${e.price_delta}`);
  if (notes) parts.push(`N:${notes.trim()}`);
  return parts.join("|");
}

export function describeCustom(c: SelectedCustom | null | undefined): string[] {
  const lines: string[] = [];
  if (!c) return lines;
  if (c.size) lines.push(c.size.label);
  if (c.milk) lines.push(`${c.milk.label} milk`);
  for (const e of c.extras ?? []) lines.push(`+ ${e.label}`);
  for (const e of c.other ?? []) lines.push(`+ ${e.label}`);
  return lines;
}
