// Decide which order lines get a drink label printed.
// Rule: labels are for coffee only. A category explicitly flagged with
// prints_label always wins; otherwise we fall back to a coffee keyword match
// on the category / item name so shops that never toggled the flag still get
// labels for coffee drinks only (and never for food, pastries, etc.).

const COFFEE_KEYWORDS = [
  "coffee",
  "espresso",
  "latte",
  "cappuccino",
  "americano",
  "macchiato",
  "mocha",
  "flat white",
  "cortado",
  "affogato",
  "ristretto",
  "cold brew",
  "brew",
  "frappe",
  "frappuccino",
  "doppio",
  "piccolo",
  "spanish latte",
  "barista",
];

const NON_COFFEE_HINTS = ["decaf-free"]; // placeholder for future exclusions

export function isCoffeeText(...parts: (string | null | undefined)[]): boolean {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return false;
  if (NON_COFFEE_HINTS.some((k) => text.includes(k))) return false;
  return COFFEE_KEYWORDS.some((k) => text.includes(k));
}

/**
 * @param printsLabel  category.prints_label for the item's category (if known)
 * @param anyFlagged   whether ANY active category has prints_label = true
 */
export function shouldPrintLabel(opts: {
  printsLabel?: boolean | null;
  anyFlagged: boolean;
  categoryName?: string | null;
  itemName?: string | null;
}): boolean {
  if (opts.anyFlagged) return opts.printsLabel === true;
  return isCoffeeText(opts.categoryName, opts.itemName);
}
