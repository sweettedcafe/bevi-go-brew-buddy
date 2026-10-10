// CSV helper that writes values in spreadsheet-friendly types:
// - Dates  -> YYYY-MM-DD (recognized as a date column)
// - Times  -> HH:MM:SS 24h (recognized as a time column)
// - Numbers / currency like "₱1,234.50" -> plain number 1234.50
// - UTF-8 BOM so Excel opens it correctly.

const DATE_LOCAL = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/; // M/D/YYYY
const TIME_LOCAL = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/;
const MONEY = /^-?[₱$]?\s?-?[\d,]+(\.\d+)?$/;

const pad = (n: number) => String(n).padStart(2, "0");

function normalize(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  let m = s.match(DATE_LOCAL);
  if (m) return `${m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
  m = s.match(TIME_LOCAL);
  if (m) {
    let h = +m[1];
    const ap = m[4]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${pad(h)}:${m[2]}:${m[3] ?? "00"}`;
  }
  // Keep long digit strings (IDs, phone numbers, invoice numbers with leading 0) as text
  if (/^0\d+/.test(s) || /^\d{12,}$/.test(s)) return s;
  if (MONEY.test(s) && /\d/.test(s)) {
    const neg = s.includes("-");
    const n = s.replace(/[₱$,\s-]/g, "");
    return neg ? `-${n}` : n;
  }
  return s;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const esc = (v: unknown) => {
    const s = normalize(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  const head = columns.map((c) => esc(c)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(",")).join("\n");
  return `${head}\n${body}`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
