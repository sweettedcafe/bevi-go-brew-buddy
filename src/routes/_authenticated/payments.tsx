import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, CreditCard } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/payments")({
  component: PaymentMethodsPage,
});

type PM = {
  id: string;
  code: string;
  label: string;
  kind: "cash" | "card" | "transfer" | "other";
  fee_percent: number;
  fee_fixed: number;
  is_active: boolean;
  sort_order: number;
};

const db = supabase as any;

function PaymentMethodsPage() {
  const { primaryRole } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [rows, setRows] = useState<PM[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PM | null>(null);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await db.from("payment_methods").select("*").order("sort_order");
    if (error) toast.error(error.message);
    setRows((data ?? []) as PM[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setEditing({
      id: "", code: "", label: "", kind: "other",
      fee_percent: 0, fee_fixed: 0, is_active: true,
      sort_order: rows.length + 1,
    });
    setOpen(true);
  }

  async function save(p: PM) {
    const payload = {
      code: p.code.trim().toLowerCase().replace(/\s+/g, "_"),
      label: p.label.trim(),
      kind: p.kind,
      fee_percent: Number(p.fee_percent) || 0,
      fee_fixed: Number(p.fee_fixed) || 0,
      is_active: p.is_active,
      sort_order: Number(p.sort_order) || 0,
    };
    if (!payload.code || !payload.label) { toast.error("Code & label required"); return; }
    const { error } = p.id
      ? await db.from("payment_methods").update(payload).eq("id", p.id)
      : await db.from("payment_methods").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    setOpen(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this payment method?")) return;
    const { error } = await db.from("payment_methods").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  async function toggle(p: PM) {
    const { error } = await db.from("payment_methods").update({ is_active: !p.is_active }).eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <CreditCard className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Payment Methods & Fees</h1>
        {isAdmin && (
          <Button className="ml-auto" onClick={startNew}>
            <Plus className="h-4 w-4 mr-1" /> New method
          </Button>
        )}
      </header>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No payment methods. Run the Phase 3 SQL to seed defaults.
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <Card key={p.id} className="p-4 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg">{p.label}</span>
                    {!p.is_active && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <code className="text-xs bg-muted px-2 py-0.5 rounded">{p.code}</code>
                  <span className="text-xs text-muted-foreground ml-2 capitalize">{p.kind}</span>
                </div>
                {isAdmin && (
                  <>
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(p.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              <div className="text-sm">
                Fee:{" "}
                <span className="text-primary font-medium">
                  {p.fee_percent}% {p.fee_fixed > 0 && `+ ${p.fee_fixed.toFixed(2)}`}
                </span>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={p.is_active} onCheckedChange={() => toggle(p)} />
                  <span className="text-xs text-muted-foreground">Active</span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <PMDialog open={open} onOpenChange={setOpen} initial={editing} onSave={save} />
      )}
    </div>
  );
}

function PMDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: PM;
  onSave: (p: PM) => Promise<void>;
}) {
  const [p, setP] = useState<PM>(initial);
  useEffect(() => { setP(initial); }, [initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{p.id ? "Edit payment method" : "New payment method"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Label</label>
              <Input value={p.label} onChange={(e) => setP({ ...p, label: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Code</label>
              <Input value={p.code} onChange={(e) => setP({ ...p, code: e.target.value })} placeholder="mada" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Kind</label>
            <Select value={p.kind} onValueChange={(v) => setP({ ...p, kind: v as PM["kind"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="transfer">Transfer / Wallet</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Fee %</label>
              <Input type="number" step="0.01"
                value={p.fee_percent}
                onChange={(e) => setP({ ...p, fee_percent: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Fee fixed</label>
              <Input type="number" step="0.01"
                value={p.fee_fixed}
                onChange={(e) => setP({ ...p, fee_fixed: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Sort order</label>
              <Input type="number" value={p.sort_order}
                onChange={(e) => setP({ ...p, sort_order: Number(e.target.value) })} />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={p.is_active} onCheckedChange={(v) => setP({ ...p, is_active: v })} />
              <span className="text-sm pb-2">Active</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(p)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
