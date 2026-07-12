// HTML generators for thermal receipts (80mm) and drink labels (50×30mm).
// CSS targets @page so it prints correctly on most thermal printers.

import type { PrintSettings } from "./print-settings";

export type ReceiptLine = { name: string; qty: number; unit_price: number; line_total: number };
export type ReceiptPayment = { label: string; amount: number };
export type ReceiptData = {
  orderNo: number;
  businessDate: string;       // YYYY-MM-DD
  createdAt: string;          // ISO
  cashier: string;
  orderType: string;
  customerName: string | null;
  lines: ReceiptLine[];
  subtotal: number;
  discountLabel: string | null;
  discountAmount: number;
  discounts?: { label: string; amount: number }[];
  total: number;
  payments: ReceiptPayment[];
  change: number;
};

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (n: number) => n.toFixed(2);
const pad = (n: number) => String(n).padStart(3, "0");

export function receiptHTML(d: ReceiptData, s: PrintSettings): string {
  const linesHTML = d.lines.map((l) => `
    <tr>
      <td class="n">${esc(l.name)}</td>
      <td class="q">${l.qty}×</td>
      <td class="p">${money(l.line_total)}</td>
    </tr>`).join("");

  const paysHTML = d.payments.map((p) => `
    <tr><td colspan="2">${esc(p.label)}</td><td class="p">${money(p.amount)}</td></tr>
  `).join("");

  return `
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Menlo", "Consolas", monospace;
         font-size: 12px; color: #000; margin: 0; padding: 0; width: 72mm; }
  .center { text-align: center; }
  .shop { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
  .meta { font-size: 11px; margin: 6px 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 2px 0; }
  td.q { width: 28px; text-align: right; padding-right: 4px; }
  td.p { width: 60px; text-align: right; }
  .totals td { font-size: 13px; }
  .grand td { font-size: 16px; font-weight: 700; padding-top: 4px; }
  .footer { text-align: center; margin-top: 8px; font-size: 11px; }
</style>
<div class="center shop">${esc(s.shopName)}</div>
<div class="center meta">
  Order #${pad(d.orderNo)} • ${esc(d.orderType.replace("_", " "))}<br/>
  ${esc(new Date(d.createdAt).toLocaleString())}<br/>
  Cashier: ${esc(d.cashier)}${d.customerName ? `<br/>Customer: ${esc(d.customerName)}` : ""}
</div>
<hr/>
<table>${linesHTML}</table>
<hr/>
<table class="totals">
  <tr><td colspan="2">Subtotal</td><td class="p">${money(d.subtotal)}</td></tr>
  ${(d.discounts && d.discounts.length > 0)
    ? d.discounts.map((x) => `<tr><td colspan="2">${esc(x.label)}</td><td class="p">-${money(x.amount)}</td></tr>`).join("")
    : (d.discountAmount > 0 ? `<tr><td colspan="2">${esc(d.discountLabel ?? "Discount")}</td><td class="p">-${money(d.discountAmount)}</td></tr>` : "")}
  <tr class="grand"><td colspan="2">TOTAL</td><td class="p">${money(d.total)}</td></tr>
</table>
<hr/>
<table>${paysHTML}
  ${d.change > 0 ? `<tr><td colspan="2"><b>Change</b></td><td class="p"><b>${money(d.change)}</b></td></tr>` : ""}
</table>
<div class="footer">${esc(s.shopFooter)}</div>
<script>/* iframe auto-prints */</script>
`;
}

export type DrinkLabel = {
  orderNo: number;
  orderId?: string | null;       // short order ID for traceability
  drinkName: string;
  cupIndex: number;     // 1-based for split cups (e.g. "1 of 2")
  cupTotal: number;
  customerName: string | null;
  notes: string | null;
  createdAt: string;
  quote?: string | null;         // random inspirational quote
};

export function labelsHTML(labels: DrinkLabel[], s: PrintSettings): string {
  if (labels.length === 0) return "";
  const each = labels.map((l, i) => `
    <section class="label${i < labels.length - 1 ? " brk" : ""}">
      <div class="row top">
        <span class="ord">#${String(l.orderNo).padStart(3, "0")}${l.orderId ? ` · ${esc(l.orderId.slice(0, 8))}` : ""}</span>
        <span class="when">${new Date(l.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div class="name">${esc(l.drinkName)}</div>
      ${l.cupTotal > 1 ? `<div class="cup">${l.cupIndex} of ${l.cupTotal}</div>` : ""}
      <div class="cust">${esc(l.customerName ?? "Walk-in")}</div>
      ${l.notes ? `<div class="notes">${esc(l.notes)}</div>` : ""}
      ${l.quote ? `<div class="quote">“${esc(l.quote)}”</div>` : ""}
      <div class="brand">${esc(s.shopName)}</div>
    </section>
  `).join("");

  return `
<style>
  @page { size: 50mm 30mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Inter", system-ui, sans-serif; color: #000; width: 50mm; }
  .label { width: 50mm; height: 30mm; padding: 1mm; display: flex; flex-direction: column; overflow: hidden; }
  .brk { page-break-after: always; }
  .row { display: flex; justify-content: space-between; gap: 2mm; font-size: 7px; line-height: 1.05; }
  .top { margin-bottom: 1px; }
  .ord { font-weight: 700; }
  .when { flex: 0 0 auto; }
  .name { font-size: 12px; font-weight: 700; line-height: 1.05; margin-top: 1px; }
  .cup  { font-size: 8px; color: #333; line-height: 1.05; }
  .cust { font-size: 9px; margin-top: 1px; font-weight: 600; line-height: 1.05; }
  .notes { font-size: 7px; font-style: italic; line-height: 1.08; }
  .quote { font-size: 6.5px; font-style: italic; color: #444; margin-top: auto; line-height: 1.08; }
  .brand { font-size: 6px; color: #666; text-align: right; margin-top: 0.5px; line-height: 1; }
</style>
${each}
`;
}
