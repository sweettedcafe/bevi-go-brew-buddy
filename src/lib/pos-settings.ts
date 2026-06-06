// Per-device POS preferences (barcode scanner, etc.)
const KEY = "bevi.pos.settings.v1";

export type PosSettings = {
  scanEnabled: boolean;
  scanAutoFocus: boolean; // keep barcode input focused on the POS screen
};

const DEFAULTS: PosSettings = {
  scanEnabled: true,
  scanAutoFocus: true,
};

export function loadPosSettings(): PosSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function savePosSettings(s: PosSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
}
