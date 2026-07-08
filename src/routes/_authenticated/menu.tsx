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
import { Pencil, Plus, Trash2, Settings2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { MenuOptionsEditor } from "@/components/menu/MenuOptionsEditor";
import { emptyOptions, hasAnyCustomization, type MenuOptions } from "@/lib/menu-options";
import { toCsv, downloadCsv } from "@/lib/csv";
import { useRef } from "react";

export const Route = createFileRoute("/_authenticated/menu")({
  component: MenuPage,
});

type Item = {
  id: string;
  product_code: string | null;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
  has_variants: boolean;
  category_id: string | null;
  owner_id: string | null;
  sort_order: number;
  options: MenuOptions | null;
};
type Cat = { id: string; name: string };
type Owner = { id: string; name: string; is_active: boolean };
type Inv = { id: string; name: string; unit: string; is_active: boolean };
type Recipe = { menu_item_id: string; inventory_item_id: string; qty_per_unit: number };
type Variant = {
  id: string; menu_item_id: string; name: string; price: number;
  sort_order: number; is_active: boolean;
};
type VariantRecipe = { variant_id: string; inventory_item_id: string; qty_per_unit: number };

const db = supabase as any;

function MenuPage() {
  const { primaryRole } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [items, setItems] = useState<Item[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [invs, setInvs] = useState<Inv[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [vrecipes, setVRecipes] = useState<VariantRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: m }, { data: c }, { data: o }, { data: i }, { data: r }, { data: v }, { data: vr }] = await Promise.all([
      db.from("menu_items").select("*").order("sort_order"),
      db.from("categories").select("id,name").order("sort_order"),
      db.from("owners").select("id,name,is_active").eq("is_active", true).order("name"),
      db.from("inventory_items").select("id,name,unit,is_active").order("name"),
      db.from("recipes").select("*"),
      db.from("menu_item_variants").select("*").order("sort_order"),
      db.from("variant_recipes").select("*"),
    ]);
    setItems((m ?? []) as Item[]);
    setCats((c ?? []) as Cat[]);
    setOwners((o ?? []) as Owner[]);
    setInvs((i ?? []) as Inv[]);
    setRecipes((r ?? []) as Recipe[]);
    setVariants((v ?? []) as Variant[]);
    setVRecipes((vr ?? []) as VariantRecipe[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";
  const ownerName = (id: string | null) => owners.find((o) => o.id === id)?.name ?? null;
  const itemRecipes = (id: string) => recipes.filter((r) => r.menu_item_id === id);
  const invName = (id: string) => invs.find((i) => i.id === id);

  async function toggleActive(it: Item) {
    const { error } = await db.from("menu_items")
      .update({ is_active: !it.is_active }).eq("id", it.id);
    if (error) return toast.error(error.message);
    toast.success(`${it.name} ${!it.is_active ? "activated" : "deactivated"}`);
    void load();
  }

  async function confirmDelete(it: Item) {
    // Try hard delete; if FK from order_items blocks it, fall back to soft delete (deactivate).
    const { error } = await db.from("menu_items").delete().eq("id", it.id);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("foreign key") || msg.includes("violates")) {
        const { error: e2 } = await db.from("menu_items").update({ is_active: false }).eq("id", it.id);
        if (e2) { setDeleting(null); return toast.error(e2.message); }
        toast.success(`${it.name} has past orders — deactivated instead of deleted.`);
      } else {
        setDeleting(null);
        return toast.error(error.message);
      }
    } else {
      toast.success(`${it.name} deleted`);
    }
    setDeleting(null);
    void load();
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-display">Menu &amp; Recipes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage drinks, ingredients per serving, and active status (hidden items disappear from POS).
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline"
              onClick={async () => {
                const name = window.prompt("New category name (e.g. Pizza, Snacks, Merchandise)")?.trim();
                if (!name) return;
                const { error } = await db.from("categories")
                  .insert({ name, sort_order: cats.length + 1, is_active: true });
                if (error) return toast.error(error.message);
                toast.success(`Category "${name}" added`);
                void load();
              }}>
              <Plus className="h-3 w-3 mr-1" /> Category
            </Button>
            <ImportExportButtons
              items={items} cats={cats} invs={invs} recipes={recipes}
              onImported={() => void load()}
            />
            <Button size="sm" onClick={() => setEditing({
              id: "", product_code: null, name: "", description: "", price: 0,
              is_active: true, has_variants: false,
              category_id: cats[0]?.id ?? null, owner_id: null,
              sort_order: items.length + 1,
              options: emptyOptions(),
            })}>
              <Plus className="h-3 w-3 mr-1" /> New item
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-muted-foreground text-sm">No menu items.</div>
      ) : (
        <div className="grid gap-3">
          {items.map((it) => {
            const rs = itemRecipes(it.id);
            const vs = variants.filter((v) => v.menu_item_id === it.id).sort((a,b) => a.sort_order - b.sort_order);
            return (
              <Card key={it.id} className={`p-4 ${!it.is_active ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{it.name}</span>
                      {it.product_code && (
                        <Badge variant="outline" className="text-[10px] font-mono">{it.product_code}</Badge>
                      )}
                      <Badge variant="secondary">{catName(it.category_id)}</Badge>
                      {ownerName(it.owner_id) && (
                        <Badge variant="outline" className="text-xs">{ownerName(it.owner_id)}</Badge>
                      )}
                      {it.has_variants && (
                        <Badge className="bg-primary/15 text-primary hover:bg-primary/15">variants</Badge>
                      )}
                      {hasAnyCustomization(it.options) && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Settings2 className="h-3 w-3" /> customizable
                        </Badge>
                      )}
                      {!it.is_active && <Badge variant="outline">inactive</Badge>}
                    </div>
                    {it.description && (
                      <div className="text-sm text-muted-foreground mt-1">{it.description}</div>
                    )}
                    {it.has_variants ? (
                      vs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {vs.map((v) => {
                            const ings = vrecipes.filter((x) => x.variant_id === v.id);
                            return (
                              <Badge key={v.id} variant="outline" className="text-xs">
                                {v.name} · {Number(v.price).toFixed(2)} · {ings.length} ing
                              </Badge>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      rs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {rs.map((r) => {
                            const ing = invName(r.inventory_item_id);
                            return (
                              <Badge key={r.inventory_item_id} variant="outline" className="text-xs">
                                {ing?.name ?? "—"}: {Number(r.qty_per_unit)} {ing?.unit ?? ""}
                              </Badge>
                            );
                          })}
                        </div>
                      )
                    )}
                  </div>
                  <div className="font-display text-lg text-primary">
                    {it.has_variants && vs.length > 0
                      ? `${Number(vs[0].price).toFixed(2)}+`
                      : Number(it.price).toFixed(2)}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <Switch checked={it.is_active} onCheckedChange={() => toggleActive(it)} />
                      <Button size="icon" variant="ghost" onClick={() => setEditing(it)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(it)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <EditMenuDialog
          item={editing}
          cats={cats}
          owners={owners}
          invs={invs}
          initialRecipes={editing.id ? itemRecipes(editing.id) : []}
          initialVariants={editing.id ? variants.filter((v) => v.menu_item_id === editing.id) : []}
          allVariantRecipes={vrecipes}
          allItems={items}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
          onOwnersChanged={() => void load()}
        />
      )}
      {deleting && (
        <Dialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete menu item?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Delete <span className="font-medium text-foreground">{deleting.name}</span>?
              If this item appears in past orders, it will be deactivated instead of removed
              so reports stay accurate.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => void confirmDelete(deleting)}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EditMenuDialog({
  item, cats, owners, invs, initialRecipes, initialVariants, allVariantRecipes,
  allItems,
  onClose, onSaved, onOwnersChanged,
}: {
  item: Item;
  cats: Cat[];
  owners: Owner[];
  invs: Inv[];
  initialRecipes: Recipe[];
  initialVariants: Variant[];
  allVariantRecipes: VariantRecipe[];
  allItems: Item[];
  onClose: () => void;
  onSaved: () => void;
  onOwnersChanged: () => void;
}) {
  const [f, setF] = useState({
    name: item.name,
    description: item.description ?? "",
    price: String(item.price),
    category_id: item.category_id ?? "",
    owner_id: item.owner_id ?? "",
    is_active: item.is_active,
    has_variants: item.has_variants,
    sort_order: String(item.sort_order),
  });
  const [rcs, setRcs] = useState<Array<{ inventory_item_id: string; qty: string }>>(
    initialRecipes.map((r) => ({ inventory_item_id: r.inventory_item_id, qty: String(r.qty_per_unit) })),
  );
  type VEdit = {
    id: string | null; name: string; price: string; is_active: boolean; sort_order: number;
    rcs: Array<{ inventory_item_id: string; qty: string }>;
  };
  const [vEdits, setVEdits] = useState<VEdit[]>(
    initialVariants
      .sort((a,b) => a.sort_order - b.sort_order)
      .map((v) => ({
        id: v.id, name: v.name, price: String(v.price),
        is_active: v.is_active, sort_order: v.sort_order,
        rcs: allVariantRecipes
          .filter((x) => x.variant_id === v.id)
          .map((x) => ({ inventory_item_id: x.inventory_item_id, qty: String(x.qty_per_unit) })),
      })),
  );
  const [options, setOptions] = useState<MenuOptions>(
    (item.options && typeof item.options === "object") ? item.options : emptyOptions(),
  );
  const [saving, setSaving] = useState(false);
  const activeInvs = useMemo(() => invs.filter((i) => i.is_active), [invs]);

  async function save() {
    if (!f.name.trim()) return toast.error("Name required");
    if (f.has_variants && vEdits.length === 0) {
      return toast.error("Add at least one variant or turn off variants");
    }
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      price: Number(f.price) || 0,
      category_id: f.category_id || null,
      owner_id: f.owner_id || null,
      is_active: f.is_active,
      has_variants: f.has_variants,
      sort_order: Number(f.sort_order) || 0,
      options,
    };
    let id = item.id;
    if (id) {
      const { error } = await db.from("menu_items").update(payload).eq("id", id);
      if (error) { setSaving(false); return toast.error(error.message); }
    } else {
      const { data, error } = await db.from("menu_items").insert(payload).select("id").single();
      if (error) { setSaving(false); return toast.error(error.message); }
      id = data.id;
    }
    // Replace top-level recipes (used when has_variants=false)
    await db.from("recipes").delete().eq("menu_item_id", id);
    if (!f.has_variants) {
      const validRcs = rcs
        .filter((r) => r.inventory_item_id && Number(r.qty) > 0)
        .map((r) => ({ menu_item_id: id, inventory_item_id: r.inventory_item_id, qty_per_unit: Number(r.qty) }));
      if (validRcs.length > 0) {
        const { error } = await db.from("recipes").insert(validRcs);
        if (error) { setSaving(false); return toast.error(error.message); }
      }
    }
    // Sync variants
    if (f.has_variants) {
      const keepIds = vEdits.filter((v) => v.id).map((v) => v.id as string);
      // delete removed variants
      const removed = initialVariants.filter((iv) => !keepIds.includes(iv.id));
      if (removed.length > 0) {
        await db.from("menu_item_variants").delete().in("id", removed.map((r) => r.id));
      }
      for (let i = 0; i < vEdits.length; i++) {
        const v = vEdits[i];
        const vPayload = {
          menu_item_id: id,
          name: v.name.trim() || `Variant ${i+1}`,
          price: Number(v.price) || 0,
          sort_order: i,
          is_active: v.is_active,
        };
        let vid = v.id;
        if (vid) {
          await db.from("menu_item_variants").update(vPayload).eq("id", vid);
        } else {
          const { data, error } = await db.from("menu_item_variants").insert(vPayload).select("id").single();
          if (error) { setSaving(false); return toast.error(error.message); }
          vid = data.id;
        }
        await db.from("variant_recipes").delete().eq("variant_id", vid);
        const vRcs = v.rcs
          .filter((r) => r.inventory_item_id && Number(r.qty) > 0)
          .map((r) => ({ variant_id: vid, inventory_item_id: r.inventory_item_id, qty_per_unit: Number(r.qty) }));
        if (vRcs.length > 0) {
          const { error } = await db.from("variant_recipes").insert(vRcs);
          if (error) { setSaving(false); return toast.error(error.message); }
        }
      }
    } else {
      // turning off variants — wipe any existing variants
      const existing = initialVariants.map((v) => v.id);
      if (existing.length > 0) {
        await db.from("menu_item_variants").delete().in("id", existing);
      }
    }
    setSaving(false);
    toast.success("Saved");
    onSaved();
  }

  function addVariant() {
    setVEdits((a) => [...a, { id: null, name: "", price: "", is_active: true, sort_order: a.length, rcs: [] }]);
  }
  function updateVariant(i: number, patch: Partial<VEdit>) {
    setVEdits((a) => a.map((v, k) => k === i ? { ...v, ...patch } : v));
  }
  function removeVariant(i: number) {
    setVEdits((a) => a.filter((_, k) => k !== i));
  }
  function addVRecipe(i: number) {
    updateVariant(i, { rcs: [...vEdits[i].rcs, { inventory_item_id: "", qty: "" }] });
  }
  function updateVRecipe(i: number, j: number, patch: Partial<{ inventory_item_id: string; qty: string }>) {
    const next = vEdits[i].rcs.map((r, k) => k === j ? { ...r, ...patch } : r);
    updateVariant(i, { rcs: next });
  }
  function removeVRecipe(i: number, j: number) {
    updateVariant(i, { rcs: vEdits[i].rcs.filter((_, k) => k !== j) });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.id ? "Edit menu item" : "New menu item"}</DialogTitle>
        </DialogHeader>
        {item.product_code && (
          <div className="text-xs text-muted-foreground -mt-2 mb-1">
            Product ID: <span className="font-mono">{item.product_code}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Description</label>
            <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          {!f.has_variants && (
            <div>
              <label className="text-xs text-muted-foreground">Price</label>
              <Input type="number" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground">Category</label>
            <Select value={f.category_id} onValueChange={(v) => setF({ ...f, category_id: v })}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Owner</label>
            <div className="flex gap-2">
              <Select value={f.owner_id || "__none__"} onValueChange={(v) => setF({ ...f, owner_id: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline"
                onClick={async () => {
                  const name = window.prompt("New owner name (e.g. Coffee Bar, Pastry Co.)")?.trim();
                  if (!name) return;
                  const { data, error } = await db.from("owners")
                    .insert({ name }).select("id").single();
                  if (error) return toast.error(error.message);
                  setF((cur) => ({ ...cur, owner_id: data.id }));
                  onOwnersChanged();
                }}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Sort order</label>
            <Input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 mt-5">
            <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
            <span className="text-sm">Active (visible in POS)</span>
          </div>
          <div className="col-span-2 flex items-center gap-2 mt-1">
            <Switch checked={f.has_variants} onCheckedChange={(v) => setF({ ...f, has_variants: v })} />
            <span className="text-sm">Has custom variants (sizes, colors, packs, flavors…)</span>
          </div>
        </div>

        {f.has_variants ? (
          <div className="mt-4 border-t pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">Custom variants</h3>
              <Button size="sm" variant="outline" onClick={addVariant}>
                <Plus className="h-3 w-3 mr-1" /> Add variant
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Name each variant anything you want (size, color, pack…). Each has its own price and recipe.
            </p>
            {vEdits.length === 0 && (
              <div className="text-xs text-muted-foreground py-2">No variants yet.</div>
            )}
            {vEdits.map((v, i) => (
              <Card key={i} className="p-3 space-y-2">
                <div className="grid grid-cols-[1fr,90px,auto,auto] gap-2 items-center">
                  <Input placeholder="Variant name (e.g. 12oz, Red, 6-pack)" value={v.name}
                    onChange={(e) => updateVariant(i, { name: e.target.value })} />
                  <Input type="number" step="0.01" placeholder="Price" value={v.price}
                    onChange={(e) => updateVariant(i, { price: e.target.value })} />
                  <Switch checked={v.is_active} onCheckedChange={(b) => updateVariant(i, { is_active: b })} />
                  <Button size="icon" variant="ghost" onClick={() => removeVariant(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-1.5 pl-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Recipe (per serving)</span>
                    <Button size="sm" variant="ghost" onClick={() => addVRecipe(i)}>
                      <Plus className="h-3 w-3 mr-1" /> Ingredient
                    </Button>
                  </div>
                  {v.rcs.map((r, j) => {
                    const ing = invs.find((x) => x.id === r.inventory_item_id);
                    return (
                      <div key={j} className="flex gap-1.5 items-center">
                        <Select value={r.inventory_item_id}
                          onValueChange={(val) => updateVRecipe(i, j, { inventory_item_id: val })}>
                          <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Pick ingredient" /></SelectTrigger>
                          <SelectContent>
                            {activeInvs.map((iv) => (
                              <SelectItem key={iv.id} value={iv.id}>{iv.name} ({iv.unit})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input className="w-20 h-8 text-xs" type="number" step="0.01" placeholder="qty"
                          value={r.qty}
                          onChange={(e) => updateVRecipe(i, j, { qty: e.target.value })} />
                        <span className="text-xs text-muted-foreground w-8">{ing?.unit ?? ""}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeVRecipe(i, j)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="mt-4 border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm">Ingredients per serving</h3>
              <Button size="sm" variant="outline"
                onClick={() => setRcs((a) => [...a, { inventory_item_id: "", qty: "" }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Quantity used per 1 serving — auto-deducted from inventory on each sale.
            </p>
            {rcs.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No ingredients yet.</div>
            ) : (
              <div className="space-y-2">
                {rcs.map((r, i) => {
                  const ing = invs.find((x) => x.id === r.inventory_item_id);
                  return (
                    <div key={i} className="flex gap-2 items-center">
                      <Select value={r.inventory_item_id}
                        onValueChange={(v) => setRcs((arr) => arr.map((x, k) => k === i ? { ...x, inventory_item_id: v } : x))}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Pick ingredient" /></SelectTrigger>
                        <SelectContent>
                          {activeInvs.map((iv) => (
                            <SelectItem key={iv.id} value={iv.id}>{iv.name} ({iv.unit})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input className="w-24" type="number" step="0.01" placeholder="qty"
                        value={r.qty}
                        onChange={(e) => setRcs((arr) => arr.map((x, k) => k === i ? { ...x, qty: e.target.value } : x))} />
                      <span className="text-xs text-muted-foreground w-10">{ing?.unit ?? ""}</span>
                      <Button size="icon" variant="ghost"
                        onClick={() => setRcs((arr) => arr.filter((_, k) => k !== i))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}


        <div className="mt-4 border-t pt-3">
          <h3 className="font-medium text-sm mb-2">Customization options</h3>
          <MenuOptionsEditor value={options} onChange={setOptions} />
        </div>

        <div className="mt-4 border-t pt-3">
          <h3 className="font-medium text-sm mb-1">Upsell suggestions</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Pick items to recommend when this one is added — shown to both the barista in POS and the customer on their ordering page.
          </p>
          <UpsellPicker
            allItems={allItems.filter((x) => x.id !== item.id && x.is_active)}
            selected={options.upsell_item_ids ?? []}
            onChange={(ids) => setOptions({ ...options, upsell_item_ids: ids })}
          />
        </div>


        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ CSV import/export ============
const MENU_CSV_COLS = [
  "product_code","name","category","price","description","is_active","sort_order",
  "ingredient","qty_per_unit","unit",
  "option_group","option_label","option_price","option_default",
];

const EMPTY_SUB = {
  ingredient: "", qty_per_unit: "", unit: "",
  option_group: "", option_label: "", option_price: "", option_default: "",
};
const EMPTY_BASE = {
  product_code: "", name: "", category: "", price: "", description: "", is_active: "", sort_order: "",
};

function ImportExportButtons({
  items, cats, invs, recipes, onImported,
}: {
  items: Item[]; cats: Cat[]; invs: Inv[]; recipes: Recipe[]; onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "";
    const rows: Record<string, any>[] = [];
    for (const it of items) {
      const rcs = recipes.filter((r) => r.menu_item_id === it.id);
      const base = {
        product_code: it.product_code ?? "",
        name: it.name,
        category: catName(it.category_id),
        price: it.price,
        description: it.description ?? "",
        is_active: it.is_active ? "true" : "false",
        sort_order: it.sort_order,
      };

      const subRows: Record<string, any>[] = [];
      for (const r of rcs) {
        const ing = invs.find((i) => i.id === r.inventory_item_id);
        subRows.push({
          ...EMPTY_SUB,
          ingredient: ing?.name ?? "",
          qty_per_unit: r.qty_per_unit,
          unit: ing?.unit ?? "",
        });
      }
      const o = it.options ?? {};
      const optList: Array<[string, any[]]> = [
        ["size", o.sizes ?? []], ["milk", o.milks ?? []], ["extra", o.extras ?? []],
      ];
      for (const [group, list] of optList) {
        for (const opt of list) {
          subRows.push({
            ...EMPTY_SUB,
            option_group: group,
            option_label: opt.label,
            option_price: opt.price_delta,
            option_default: opt.is_default ? "true" : "",
          });
        }
      }
      const flags: Array<[string, boolean | undefined]> = [
        ["allow_other", o.allow_other],
        ["allow_notes", o.allow_notes],
        ["size_required", o.size_required],
      ];
      for (const [k, v] of flags) {
        if (v) subRows.push({
          ...EMPTY_SUB, option_group: "flag", option_label: k, option_price: "true",
        });
      }

      if (subRows.length === 0) {
        rows.push({ ...base, ...EMPTY_SUB });
      } else {
        subRows.forEach((s, i) => {
          rows.push({ ...(i === 0 ? base : EMPTY_BASE), ...s });
        });
      }
    }
    downloadCsv(`menu-export-${new Date().toISOString().slice(0,10)}.csv`,
      toCsv(rows, MENU_CSV_COLS));
    toast.success(`Exported ${items.length} item(s)`);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) return toast.error("CSV is empty");

      // Forward-fill name + product_code so option/ingredient rows can be blank.
      let lastName = "";
      let lastCode = "";
      type Group = {
        base: Record<string, any> | null;
        ings: { name: string; qty: number }[];
        sizes: any[]; milks: any[]; extras: any[];
        allow_other?: boolean; allow_notes?: boolean; size_required?: boolean;
      };
      const groups = new Map<string, Group>();

      for (const r of parsed) {
        const rowCode = String(r.product_code ?? "").trim();
        const rowName = String(r.name ?? "").trim();
        if (rowCode) lastCode = rowCode;
        if (rowName) lastName = rowName;
        if (!lastName && !lastCode) continue;
        const key = (lastCode || lastName).toLowerCase();
        let g = groups.get(key);
        if (!g) {
          g = { base: null, ings: [], sizes: [], milks: [], extras: [] };
          groups.set(key, g);
        }
        if (!g.base && (rowName || r.price || r.category || r.description || r.is_active || r.sort_order || rowCode)) {
          g.base = { ...r, name: lastName, product_code: lastCode };
        }
        const ingName = String(r.ingredient ?? "").trim();
        if (ingName && Number(r.qty_per_unit) > 0) {
          g.ings.push({ name: ingName, qty: Number(r.qty_per_unit) });
        }
        const grp = String(r.option_group ?? "").trim().toLowerCase();
        const lbl = String(r.option_label ?? "").trim();
        if (grp && lbl) {
          if (grp === "flag") {
            const val = /^(true|1|yes)$/i.test(String(r.option_price ?? "true"));
            if (lbl === "allow_other") g.allow_other = val;
            else if (lbl === "allow_notes") g.allow_notes = val;
            else if (lbl === "size_required") g.size_required = val;
          } else {
            const opt = {
              label: lbl,
              price_delta: Number(r.option_price) || 0,
              is_default: /^(true|1|yes)$/i.test(String(r.option_default ?? "")),
            };
            if (grp === "size") g.sizes.push(opt);
            else if (grp === "milk") g.milks.push(opt);
            else if (grp === "extra") g.extras.push(opt);
          }
        }
      }

      const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
      const invByName = new Map(invs.map((i) => [i.name.toLowerCase(), i.id]));
      const itemByName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
      const itemByCode = new Map(items.filter((i) => i.product_code).map((i) => [i.product_code!.toLowerCase(), i]));

      let created = 0, updated = 0, skipped = 0;
      const unknownIngs = new Set<string>();

      for (const [, g] of groups) {
        const baseRow = g.base ?? {};
        const name = String(baseRow.name ?? "").trim();
        const code = String(baseRow.product_code ?? "").trim();
        if (!name && !code) { skipped++; continue; }
        const catId = catByName.get(String(baseRow.category ?? "").toLowerCase()) ?? null;

        const opts: MenuOptions = {
          sizes: g.sizes,
          milks: g.milks,
          extras: g.extras,
          allow_other: g.allow_other ?? false,
          allow_notes: g.allow_notes ?? true,
          size_required: g.size_required ?? false,
        };
        const hasOpts = g.sizes.length || g.milks.length || g.extras.length
          || g.allow_other || g.size_required;

        const payload: any = {
          name: name || (code ? code : "Unnamed"),
          description: String(baseRow.description ?? "").trim() || null,
          price: Number(baseRow.price) || 0,
          category_id: catId,
          is_active: /^(true|1|yes)$/i.test(String(baseRow.is_active ?? "true")),
          sort_order: Number(baseRow.sort_order) || 0,
          options: hasOpts ? opts : emptyOptions(),
        };
        // Match by product_code first, then by name
        const existing = (code && itemByCode.get(code.toLowerCase()))
          || (name && itemByName.get(name.toLowerCase())) || null;
        let id: string;
        if (existing) {
          const { error } = await db.from("menu_items").update(payload).eq("id", existing.id);
          if (error) { skipped++; continue; }
          id = existing.id;
          updated++;
        } else {
          // Preserve incoming product_code if provided (must be unique)
          const insertPayload = code ? { ...payload, product_code: code } : payload;
          const { data, error } = await db.from("menu_items").insert(insertPayload).select("id").single();
          if (error) { skipped++; continue; }
          id = data.id;
          created++;
        }
        await db.from("recipes").delete().eq("menu_item_id", id);
        const validIngs = g.ings
          .map((x) => {
            const iid = invByName.get(x.name.toLowerCase());
            if (!iid) { unknownIngs.add(x.name); return null; }
            return { menu_item_id: id, inventory_item_id: iid, qty_per_unit: x.qty };
          })
          .filter(Boolean) as any[];
        if (validIngs.length) await db.from("recipes").insert(validIngs);
      }

      toast.success(`Import done: ${created} new, ${updated} updated, ${skipped} skipped` +
        (unknownIngs.size ? ` (unknown ingredients: ${[...unknownIngs].join(", ")})` : ""));
      onImported();
    } catch (err: any) {
      toast.error(`Import failed: ${err?.message ?? err}`);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleExport}>
        <Download className="h-3 w-3 mr-1" /> Export CSV
      </Button>
      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
        <Upload className="h-3 w-3 mr-1" /> Import CSV
      </Button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
    </>
  );
}


function parseCsv(text: string): Record<string, string>[] {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); lines.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); lines.push(cur); }
  const rows = lines.filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
}

// ---- Upsell picker (used in EditMenuDialog) ----
function UpsellPicker({
  allItems, selected, onChange,
}: {
  allItems: Item[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const set = new Set(selected);
  const filtered = allItems
    .filter((it) => !q.trim() || it.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const picked = allItems.filter((i) => set.has(i.id));

  function toggle(id: string) {
    if (set.has(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  return (
    <div className="space-y-2">
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <Badge key={p.id} className="cursor-pointer" onClick={() => toggle(p.id)}>
              {p.name} <span className="ml-1 opacity-70">×</span>
            </Badge>
          ))}
        </div>
      )}
      <Input placeholder="Search items to add…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-40 overflow-y-auto border rounded divide-y">
        {filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">No items.</div>
        ) : filtered.slice(0, 30).map((it) => {
          const on = set.has(it.id);
          return (
            <button key={it.id} type="button" onClick={() => toggle(it.id)}
              className={`w-full flex items-center justify-between px-2 py-1.5 text-sm text-left ${on ? "bg-primary/10" : "hover:bg-accent"}`}>
              <span>{it.name}</span>
              <span className="text-xs text-muted-foreground">{on ? "Added" : "+ Add"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
