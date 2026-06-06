import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, Plus, Trash2, Package } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bundles")({
  component: BundlesPage,
});

type Bundle = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};
type BundleItem = { id?: string; bundle_id?: string; menu_item_id: string; qty: number };
type MenuItem = { id: string; name: string; price: number };

const db = supabase as any;

function BundlesPage() {
  const { primaryRole } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [bItems, setBItems] = useState<BundleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Bundle | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: b }, { data: m }, { data: bi }] = await Promise.all([
      db.from("bundles").select("*").order("created_at", { ascending: false }),
      db.from("menu_items").select("id,name,price").eq("is_active", true).order("name"),
      db.from("bundle_items").select("*"),
    ]);
    setBundles((b ?? []) as Bundle[]);
    setItems((m ?? []) as MenuItem[]);
    setBItems((bi ?? []) as BundleItem[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const itemName = (id: string) => items.find((x) => x.id === id)?.name ?? "—";
  const bItemsFor = (id: string) => bItems.filter((x) => x.bundle_id === id);
  const isExpired = (b: Bundle) => b.ends_at && new Date(b.ends_at) < new Date();

  async function remove(id: string) {
    if (!confirm("Delete this bundle?")) return;
    const { error } = await db.from("bundles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }

  async function toggle(b: Bundle) {
    const { error } = await db.from("bundles").update({ is_active: !b.is_active }).eq("id", b.id);
    if (error) return toast.error(error.message);
    void load();
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <Package className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl sm:text-3xl font-display">Bundles</h1>
          <p className="text-sm text-muted-foreground">
            Combo offers shown in the POS. Bundles past their expiry date are automatically hidden.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setEditing({
            id: "", name: "", description: "", price: 0,
            starts_at: null, ends_at: null, is_active: true,
          })}>
            <Plus className="h-3 w-3 mr-1" /> New bundle
          </Button>
        )}
      </header>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : bundles.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">No bundles yet.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {bundles.map((b) => {
            const expired = isExpired(b);
            const its = bItemsFor(b.id);
            return (
              <Card key={b.id} className={`p-4 ${(!b.is_active || expired) ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-lg">{b.name}</span>
                      {!b.is_active && <Badge variant="outline">inactive</Badge>}
                      {expired && <Badge variant="destructive">expired</Badge>}
                    </div>
                    {b.description && <div className="text-sm text-muted-foreground">{b.description}</div>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {its.map((x) => (
                        <Badge key={x.id} variant="secondary" className="text-xs">
                          {itemName(x.menu_item_id)} × {x.qty}
                        </Badge>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      {b.starts_at && <>Starts: {new Date(b.starts_at).toLocaleString()}<br /></>}
                      {b.ends_at && <>Ends: {new Date(b.ends_at).toLocaleString()}</>}
                    </div>
                  </div>
                  <div className="font-display text-xl text-primary">{Number(b.price).toFixed(2)}</div>
                  {isAdmin && (
                    <div className="flex flex-col items-end gap-1">
                      <Switch checked={b.is_active} onCheckedChange={() => toggle(b)} />
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(b)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(b.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <EditBundleDialog
          bundle={editing}
          items={items}
          initialItems={editing.id ? bItemsFor(editing.id) : []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function EditBundleDialog({
  bundle, items, initialItems, onClose, onSaved,
}: {
  bundle: Bundle;
  items: MenuItem[];
  initialItems: BundleItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: bundle.name,
    description: bundle.description ?? "",
    price: String(bundle.price),
    starts_at: bundle.starts_at ? bundle.starts_at.slice(0, 16) : "",
    ends_at: bundle.ends_at ? bundle.ends_at.slice(0, 16) : "",
    is_active: bundle.is_active,
  });
  const [rows, setRows] = useState<Array<{ menu_item_id: string; qty: string }>>(
    initialItems.map((x) => ({ menu_item_id: x.menu_item_id, qty: String(x.qty) })),
  );
  const [saving, setSaving] = useState(false);

  const componentTotal = useMemo(() =>
    rows.reduce((s, r) => {
      const it = items.find((x) => x.id === r.menu_item_id);
      return s + (it ? Number(it.price) * (Number(r.qty) || 0) : 0);
    }, 0),
  [rows, items]);

  async function save() {
    if (!f.name.trim()) return toast.error("Name required");
    if (rows.length === 0 || rows.some((r) => !r.menu_item_id || Number(r.qty) <= 0))
      return toast.error("Add at least one item with qty > 0");
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      price: Number(f.price) || 0,
      starts_at: f.starts_at || null,
      ends_at: f.ends_at || null,
      is_active: f.is_active,
    };
    let id = bundle.id;
    if (id) {
      const { error } = await db.from("bundles").update(payload).eq("id", id);
      if (error) { setSaving(false); return toast.error(error.message); }
    } else {
      const { data, error } = await db.from("bundles").insert(payload).select("id").single();
      if (error) { setSaving(false); return toast.error(error.message); }
      id = data.id;
    }
    await db.from("bundle_items").delete().eq("bundle_id", id);
    const ins = rows.map((r) => ({
      bundle_id: id, menu_item_id: r.menu_item_id, qty: Number(r.qty),
    }));
    const { error: e2 } = await db.from("bundle_items").insert(ins);
    if (e2) { setSaving(false); return toast.error(e2.message); }
    setSaving(false);
    toast.success("Saved");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bundle.id ? "Edit bundle" : "New bundle"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Bundle name</label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Description</label>
            <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Bundle price</label>
            <Input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 mt-5">
            <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
            <span className="text-sm">Active</span>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Starts at (optional)</label>
            <Input type="datetime-local" value={f.starts_at}
              onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ends at (auto-hide after)</label>
            <Input type="datetime-local" value={f.ends_at}
              onChange={(e) => setF({ ...f, ends_at: e.target.value })} />
          </div>
        </div>

        <div className="mt-4 border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm">Items in this bundle</h3>
            <Button size="sm" variant="outline"
              onClick={() => setRows((a) => [...a, { menu_item_id: "", qty: "1" }])}>
              <Plus className="h-3 w-3 mr-1" /> Add item
            </Button>
          </div>
          {rows.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No items selected.</div>
          ) : (
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={r.menu_item_id}
                    onValueChange={(v) => setRows((arr) => arr.map((x, k) => k === i ? { ...x, menu_item_id: v } : x))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Pick item" /></SelectTrigger>
                    <SelectContent>
                      {items.map((it) => (
                        <SelectItem key={it.id} value={it.id}>{it.name} ({Number(it.price).toFixed(2)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input className="w-20" type="number" value={r.qty}
                    onChange={(e) => setRows((arr) => arr.map((x, k) => k === i ? { ...x, qty: e.target.value } : x))} />
                  <Button size="icon" variant="ghost"
                    onClick={() => setRows((arr) => arr.filter((_, k) => k !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs text-muted-foreground">
            Components total: {componentTotal.toFixed(2)} · Bundle save:{" "}
            <span className="text-primary">
              {Math.max(0, componentTotal - (Number(f.price) || 0)).toFixed(2)}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
