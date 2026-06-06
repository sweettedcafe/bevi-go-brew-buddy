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
import { Plus, Pencil, Trash2, Ticket } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/discounts")({
  component: DiscountsPage,
});

type Discount = {
  id: string;
  code: string | null;
  name: string;
  type: "percent" | "fixed";
  value: number;
  min_subtotal: number;
  max_uses: number | null;
  uses_count: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  applies_to_item_id: string | null;
};
type MenuItemLite = { id: string; name: string };

const db = supabase as any;

function DiscountsPage() {
  const { primaryRole } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [rows, setRows] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [open, setOpen] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItemLite[]>([]);

  async function load() {
    setLoading(true);
    const [{ data, error }, { data: m }] = await Promise.all([
      db.from("discounts").select("*").order("created_at", { ascending: false }),
      db.from("menu_items").select("id,name").eq("is_active", true).order("name"),
    ]);
    if (error) toast.error(error.message);
    setRows((data ?? []) as Discount[]);
    setMenuItems((m ?? []) as MenuItemLite[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setEditing({
      id: "", code: "", name: "", type: "percent", value: 10,
      min_subtotal: 0, max_uses: null, uses_count: 0,
      starts_at: null, ends_at: null, is_active: true,
      applies_to_item_id: null,
    });
    setOpen(true);
  }

  async function save(d: Discount) {
    const payload = {
      code: d.code?.trim() ? d.code.trim().toUpperCase() : null,
      name: d.name.trim(),
      type: d.type,
      value: Number(d.value),
      min_subtotal: Number(d.min_subtotal) || 0,
      max_uses: d.max_uses == null || d.max_uses === ('' as any) ? null : Number(d.max_uses),
      starts_at: d.starts_at || null,
      ends_at: d.ends_at || null,
      is_active: d.is_active,
      applies_to_item_id: d.applies_to_item_id || null,
    };
    if (!payload.name) { toast.error("Name required"); return; }
    const { error } = d.id
      ? await db.from("discounts").update(payload).eq("id", d.id)
      : await db.from("discounts").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    setOpen(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this discount?")) return;
    const { error } = await db.from("discounts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  async function toggle(d: Discount) {
    const { error } = await db.from("discounts").update({ is_active: !d.is_active }).eq("id", d.id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Ticket className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Discounts & Promo Codes</h1>
        {isAdmin && (
          <Button className="ml-auto" onClick={startNew}>
            <Plus className="h-4 w-4 mr-1" /> New discount
          </Button>
        )}
      </header>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No discounts yet. {isAdmin && "Create one to offer promo codes at checkout."}
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((d) => (
            <Card key={d.id} className="p-4 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg">{d.name}</span>
                    {!d.is_active && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  {d.code && <code className="text-xs bg-muted px-2 py-0.5 rounded">{d.code}</code>}
                </div>
                {isAdmin && (
                  <>
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(d); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(d.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              <div className="text-2xl font-display text-primary">
                {d.type === "percent" ? `${d.value}%` : d.value.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {d.min_subtotal > 0 && <div>Min subtotal: {d.min_subtotal.toFixed(2)}</div>}
                <div>
                  Uses: {d.uses_count}
                  {d.max_uses != null && ` / ${d.max_uses}`}
                </div>
                {d.ends_at && <div>Ends: {new Date(d.ends_at).toLocaleDateString()}</div>}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={d.is_active} onCheckedChange={() => toggle(d)} />
                  <span className="text-xs text-muted-foreground">Active</span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <DiscountDialog
          open={open}
          onOpenChange={setOpen}
          initial={editing}
          menuItems={menuItems}
          onSave={save}
        />
      )}
    </div>
  );
}

function DiscountDialog({
  open, onOpenChange, initial, menuItems, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: Discount;
  menuItems: MenuItemLite[];
  onSave: (d: Discount) => Promise<void>;
}) {
  const [d, setD] = useState<Discount>(initial);
  useEffect(() => { setD(initial); }, [initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.id ? "Edit discount" : "New discount"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Promo code <span className="opacity-60">(leave blank for manager-only manual discount)</span>
            </label>
            <Input
              value={d.code ?? ""}
              onChange={(e) => setD({ ...d, code: e.target.value })}
              placeholder="WELCOME10"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Type</label>
              <Select value={d.type} onValueChange={(v) => setD({ ...d, type: v as "percent" | "fixed" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent (%)</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Value</label>
              <Input
                type="number"
                value={d.value}
                onChange={(e) => setD({ ...d, value: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Min subtotal</label>
              <Input
                type="number"
                value={d.min_subtotal}
                onChange={(e) => setD({ ...d, min_subtotal: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Max uses (blank = ∞)</label>
              <Input
                type="number"
                value={d.max_uses ?? ""}
                onChange={(e) =>
                  setD({ ...d, max_uses: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Starts at</label>
              <Input
                type="datetime-local"
                value={d.starts_at ? d.starts_at.slice(0, 16) : ""}
                onChange={(e) => setD({ ...d, starts_at: e.target.value || null })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Ends at</label>
              <Input
                type="datetime-local"
                value={d.ends_at ? d.ends_at.slice(0, 16) : ""}
                onChange={(e) => setD({ ...d, ends_at: e.target.value || null })}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Applies to (leave blank = whole order)
            </label>
            <Select
              value={d.applies_to_item_id ?? "__all__"}
              onValueChange={(v) => setD({ ...d, applies_to_item_id: v === "__all__" ? null : v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Whole order (subtotal)</SelectItem>
                {menuItems.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              If an item is selected, the discount only reduces that specific item's line in the POS.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={d.is_active} onCheckedChange={(v) => setD({ ...d, is_active: v })} />
            <span className="text-sm">Active</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(d)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
