// Reusable reprint helpers — receipt + drink labels — used by /history and /pos
import { supabase } from "@/integrations/supabase/client";
import { loadPrintSettings } from "./print-settings";
import { savePdfFromHTML } from "./print-pdf";
import { receiptHTML, labelsHTML, type ReceiptData, type DrinkLabel } from "./print-templates";
import { randomQuote } from "./quotes";
import type { PrintPreviewDocument } from "@/components/print/PrintPreviewDialog";

const db = supabase as any;

export type AnyOrder = {
  id: string;
  order_no: number;
  business_date: string;
  customer_name: string | null;
  order_type: string;
  subtotal: number | string;
  discount_total: number | string;
  discount_label: string | null;
  total: number | string;
  created_at: string;
};

export async function reprintReceiptById(orderId: string, fallbackCashier = "—") {
  return buildReceiptPreviewById(orderId, fallbackCashier);
}

export async function buildReceiptPreviewById(orderId: string, fallbackCashier = "—"): Promise<PrintPreviewDocument> {
  const res = await buildReceiptHtml(orderId, fallbackCashier);
  return {
    id: "receipt",
    label: "Receipt",
    title: `Receipt #${res.orderNo}`,
    html: res.html,
    filename: `receipt-${String(res.orderNo).padStart(3, "0")}.pdf`,
    widthMm: 80,
  };
}

async function loadReceiptData(orderId: string, fallbackCashier: string) {
  const [{ data: ord }, { data: items }, { data: payments }, pms] = await Promise.all([
    db.from("orders").select("*").eq("id", orderId).maybeSingle(),
    db.from("order_items").select("*").eq("order_id", orderId),
    db.from("order_payments").select("*").eq("order_id", orderId).order("created_at"),
    db.from("payment_methods").select("code,label"),
  ]);
  if (!ord) throw new Error("Order not found");
  const labelMap = new Map<string, string>(
    ((pms.data ?? []) as { code: string; label: string }[]).map((p) => [p.code, p.label]),
  );
  const data: ReceiptData = {
    orderNo: ord.order_no,
    businessDate: ord.business_date,
    createdAt: ord.created_at,
    cashier: fallbackCashier,
    orderType: ord.order_type,
    customerName: ord.customer_name,
    lines: (items ?? []).map((l: any) => ({
      name: l.name_snapshot, qty: l.qty,
      unit_price: Number(l.unit_price), line_total: Number(l.line_total),
    })),
    subtotal: Number(ord.subtotal),
    discountLabel: ord.discount_label,
    discountAmount: Number(ord.discount_total),
    total: Number(ord.total),
    payments: (payments ?? []).map((p: any) => ({
      label: labelMap.get(p.method_code) ?? p.method_code ?? p.method ?? "Payment",
      amount: Number(p.amount),
    })),
    change: (payments ?? []).reduce((s: number, p: any) => s + Number(p.change_due ?? 0), 0),
  };
  return { data, orderNo: ord.order_no as number };
}

export async function saveReceiptPdfById(orderId: string, fallbackCashier = "—") {
  const res = await buildReceiptHtml(orderId, fallbackCashier);
  await savePdfFromHTML(res.html, `receipt-${String(res.orderNo).padStart(3, "0")}.pdf`, 80);
}

async function buildReceiptHtml(orderId: string, fallbackCashier: string) {
  const { data, orderNo } = await loadReceiptData(orderId, fallbackCashier);
  return { html: receiptHTML(data, loadPrintSettings()), orderNo };
}

export async function reprintLabelsById(orderId: string): Promise<PrintPreviewDocument | false> {
  const { data: ord } = await db.from("orders").select("order_no, customer_name, created_at").eq("id", orderId).maybeSingle();
  if (!ord) throw new Error("Order not found");
  const [{ data: items }, { data: cats }] = await Promise.all([
    db
      .from("order_items")
      .select("menu_item_id, name_snapshot, qty, notes, menu_items(category_id, categories(prints_label))")
      .eq("order_id", orderId),
    db.from("categories").select("prints_label").eq("is_active", true),
  ]);
  // If no category is explicitly flagged for labels, print a label for every item
  // (coffee shops that haven't toggled prints_label per category yet).
  const anyFlagged = ((cats ?? []) as any[]).some((c) => c.prints_label === true);
  const labels: DrinkLabel[] = [];
  for (const it of (items ?? []) as any[]) {
    if (anyFlagged && it.menu_items?.categories?.prints_label !== true) continue;
    const total = Number(it.qty);
    for (let i = 1; i <= total; i++) {
      labels.push({
        orderNo: ord.order_no,
        orderId: orderId,
        drinkName: it.name_snapshot,
        cupIndex: i, cupTotal: total,
        customerName: ord.customer_name,
        notes: it.notes,
        createdAt: ord.created_at,
        quote: randomQuote(),
      });
    }
  }
  if (labels.length === 0) return false;
  const orderNo = ord.order_no as number;
  return {
    id: "labels",
    label: "Labels",
    title: `Labels #${orderNo}`,
    html: labelsHTML(labels, loadPrintSettings()),
    filename: `labels-${String(orderNo).padStart(3, "0")}.pdf`,
    widthMm: 50,
  };
}

