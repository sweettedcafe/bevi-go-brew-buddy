// Per-device printer hints. Browsers don't let JS pick the physical printer,
// so these are display names the cashier sets in Chrome's "Always print to"
// dialog. We keep separate names so receipt and label go to the right device.
const KEY = "bevi.print.settings.v1";

export type PrintSettings = {
  receiptPrinter: string;   // display name only
  labelPrinter: string;     // display name only
  autoPrintReceipt: boolean;
  autoPrintLabels: boolean;
  shopName: string;
  shopFooter: string;
};

const DEFAULTS: PrintSettings = {
  receiptPrinter: "",
  labelPrinter: "",
  autoPrintReceipt: true,
  autoPrintLabels: true,
  shopName: "Bevi & Go",
  shopFooter: "Thank you — see you again!",
};

export function loadPrintSettings(): PrintSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function savePrintSettings(s: PrintSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
}
