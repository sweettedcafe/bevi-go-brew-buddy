import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { XCircle } from "lucide-react";

const db = supabase as any;

type Props = {
  orderId: string;
  onClose: () => void;
  onChanged?: () => void;
  canReverse?: boolean;
};

type ReverseTarget =
  | { kind: "void"; scope: "order" }
  | { kind: "void"; scope: "item"; itemId: string; maxQty: number; name: string };

export function OrderDetailSheet({ orderId, onClose, onChanged, canReverse = true }: Props) {
  const [data, setData] = useState<any>(null);
  const [target, setTarget] = useState<ReverseTarget | null>(null);
  const [qty, setQty] = useState<string>("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: o, error: oErr }, { data: items, error: iErr }, { data: pays }, { data: pms }] = await Promise.all([
      db.from("orders").select("*").eq("id", orderId).maybeSingle(),
      db.from("order_items").select("*").eq("order_id", orderId),
      db.from("order_payments").select("*").eq("order_id", orderId),
      db.from("payment_methods").select("code,label"),
    ]);
    if (oErr) toast.error(oErr.message);
    if (iErr) toast.error(iErr.message);
    // reversed qty per parent item
    const parentIds = (items ?? []).map((i: any) => i.id);
    let reversedByParent: Record<string, number> = {};
    if (parentIds.length) {
      const { data: mirrors } = await db
        .from("order_items")
        .select("parent_item_id, qty")
        .in("parent_item_id", parentIds);
      for (const m of (mirrors ?? []) as any[]) {
        reversedByParent[m.parent_item_id] =
          (reversedByParent[m.parent_item_id] ?? 0) + Math.abs(Number(m.qty));
      }
    }
    const pmMap = new Map<string, string>(((pms ?? []) as any[]).map((p) => [p.code, p.label]));
    setData({ o, items: items ?? [], pays: pays ?? [], pmMap, reversedByParent });
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [orderId]);

  async function doReverse() {
    if (!target) return;
    setBusy(true);
    try {
      if (target.scope === "order") {
        const { error } = await db.rpc("pos_void_order_v2", { p_order_id: orderId, p_reason: reason || null });
        if (error) throw error;
      } else {
        const n = Number(qty);
        if (!Number.isFinite(n) || n <= 0) throw new Error("Quantity must be > 0");
        if (n > target.maxQty) throw new Error(`Only ${target.maxQty} remaining`);
        const { error } = await db.rpc("pos_void_order_item", {
          p_order_item_id: target.itemId, p_qty: n, p_reason: reason || null,
        });
        if (error) throw error;
      }
      toast.success("Voided successfully");
      setTarget(null); setReason(""); setQty("1");
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent><div className="text-sm text-muted-foreground py-6">Loading…</div></DialogContent>
      </Dialog>
    );
  }

  const { o, items, pays, pmMap, reversedByParent } = data;
  const isSale = o.txn_kind === "sale" || o.txn_kind == null;
  const orderClosed = o.status === "voided" || o.status === "refunded";
  const allowOrderActions = canReverse && isSale && !orderClosed;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Order #{String(o.order_no).padStart(3, "0")}
            <Badge variant={isSale ? (o.status === "completed" ? "default" : "secondary") : "destructive"} className="capitalize">
              {isSale ? o.status : (o.txn_kind === "void" ? "voided" : "refunded")}
            </Badge>
            {!isSale && <Badge variant="outline" className="capitalize">{o.txn_kind}</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          {new Date(o.created_at).toLocaleString()} · {o.order_type?.replace("_", " ")} ·
          {" "}{o.customer_name ?? "Walk-in"}
        </div>

        <div className="border rounded-md divide-y max-h-[40vh] overflow-auto">
          {items.map((it: any) => {
            const origQty = Number(it.qty);
            const reversed = reversedByParent[it.id] ?? 0;
            const remaining = isSale ? Math.max(0, origQty - reversed) : 0;
            return (
              <div key={it.id} className="p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <div className="font-medium">
                    {it.qty}× {it.name_snapshot}
                    {reversed > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">({reversed} reversed)</span>
                    )}
                  </div>
                  <div>₱{Number(it.line_total).toFixed(2)}</div>
                </div>
                {it.notes && <div className="text-xs italic text-muted-foreground pl-3 mt-0.5">"{it.notes}"</div>}
                {canReverse && isSale && remaining > 0 && (
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" variant="outline" className="h-7"
                      onClick={() => { setTarget({ kind: "void", scope: "item", itemId: it.id, maxQty: remaining, name: it.name_snapshot }); setQty(String(remaining)); }}>
                      <XCircle className="h-3 w-3 mr-1" /> Void
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-sm space-y-1">
          <Row k="Subtotal" v={`₱${Number(o.subtotal).toFixed(2)}`} />
          {Number(o.discount_total) !== 0 && (
            <Row k={`Discount${o.discount_label ? ` (${o.discount_label})` : ""}`}
              v={`${Number(o.discount_total) > 0 ? "− " : ""}₱${Math.abs(Number(o.discount_total)).toFixed(2)}`} />
          )}
          {pays.map((p: any) => (
            <Row key={p.id}
              k={`${pmMap.get(p.method_code) ?? p.method_code ?? p.method}`}
              v={`₱${Number(p.amount).toFixed(2)}${Number(p.change_due) > 0 ? ` (change ₱${Number(p.change_due).toFixed(2)})` : ""}`} />
          ))}
          <Row k="Total" v={`₱${Number(o.total).toFixed(2)}`} bold />
        </div>

        <DialogFooter className="gap-2">
          {allowOrderActions && (
            <Button variant="outline" onClick={() => { setTarget({ kind: "void", scope: "order" }); setReason(""); }}>
              <XCircle className="h-4 w-4 mr-1" /> Void entire order
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>

        {target && (
          <Dialog open onOpenChange={(open) => !open && setTarget(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="capitalize">
                  {target.kind} {target.scope === "order" ? "entire order" : target.name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {target.scope === "item" && (
                  <div>
                    <Label className="text-xs">Quantity (max {target.maxQty})</Label>
                    <Input type="number" min="1" step="1" max={target.maxQty}
                      value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label className="text-xs">Reason</Label>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this being reversed?" rows={3} />
                </div>
                <p className="text-xs text-muted-foreground">
                  A mirror negative transaction will be created for accounting. Stock is restored.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>Cancel</Button>
                <Button onClick={doReverse} disabled={busy}>
                  {busy ? "Working…" : `Confirm ${target.kind}`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-display text-base" : ""}`}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}
