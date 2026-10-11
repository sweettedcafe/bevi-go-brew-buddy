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
import { StableModal, StableModalFooter } from "@/components/ui/stable-modal";
import { Pencil, Plus, Trash2, Settings2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { MenuOptionsEditor } from "@/components/menu/MenuOptionsEditor";
import { emptyOptions, hasAnyCustomization, type MenuOptions } from "@/lib/menu-options";
import { toCsv, downloadCsv } from "@/lib/csv";
import { useRef } from "react";
import { MultiSelect } from "@/components/MultiSelect";

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
  image_url: string | null;
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
  const [fCats, setFCats] = useState<string[]>([]);
  const [fOwners, setFOwners] = useState<string[]>([]);

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
  const shownItems = items.filter((it) =>
    (fCats.length === 0 || fCats.includes(it.category_id ?? "__none__")) &&
    (fOwners.length === 0 || fOwners.includes(it.owner_id ?? "__none__")));

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
              items={items} exportItems={shownItems} cats={cats} owners={owners} invs={invs} recipes={recipes}
              variants={variants} vrecipes={vrecipes}
              onImported={() => void load()}
            />
            <Button size="sm" onClick={() => setEditing({
              id: "", product_code: null, name: "", description: "", price: 0,
              is_active: true, has_variants: false,
              category_id: cats[0]?.id ?? null, owner_id: null,
              sort_order: items.length + 1,
              options: emptyOptions(), image_url: null,
            })}>
              <Plus className="h-3 w-3 mr-1" /> New item
            </Button>
          </div>
        )}
      </div>

      {isAdmin && cats.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-medium mb-2">Categories</div>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <div key={c.id} className="flex items-center gap-1 rounded-md border bg-card px-2 py-1">
                <span className="text-sm">{c.name}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6"
                  onClick={async () => {
                    const name = window.prompt("Rename category", c.name)?.trim();
                    if (!name || name === c.name) return;
                    const { error } = await db.rpc("admin_rename_category", { p_id: c.id, p_name: name });
                    if (error) return toast.error(error.message);
                    toast.success("Category renamed");
                    void load();
                  }}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={async () => {
                    const used = items.filter((it) => it.category_id === c.id).length;
                    const msg = used > 0
                      ? `Delete "${c.name}"? ${used} item(s) will become uncategorized.`
                      : `Delete "${c.name}"?`;
                    if (!window.confirm(msg)) return;
                    const { error } = await db.rpc("admin_delete_category", { p_id: c.id });
                    if (error) return toast.error(error.message);
                    toast.success("Category deleted");
                    void load();
                  }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-3 mb-4 flex flex-wrap items-end gap-3">
        <div><label className="text-xs text-muted-foreground block mb-1">Category</label>
          <MultiSelect allLabel="All categories" selected={fCats} onChange={setFCats}
            options={[...cats.map((c) => ({ value: c.id, label: c.name })), { value: "__none__", label: "(Uncategorized)" }]} /></div>
        <div><label className="text-xs text-muted-foreground block mb-1">Owner</label>
          <MultiSelect allLabel="All owners" selected={fOwners} onChange={setFOwners}
            options={[...owners.map((o) => ({ value: o.id, label: o.name })), { value: "__none__", label: "(No owner)" }]} /></div>
        <div className="text-xs text-muted-foreground pb-2">Showing {shownItems.length} of {items.length} items</div>
      </Card>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : shownItems.length === 0 ? (
        <div className="text-muted-foreground text-sm">No menu items.</div>
      ) : (
        <div className="grid gap-3">
          {shownItems.map((it) => {
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
        <StableModal
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete menu item?"
          className="max-w-sm"
        >
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">{deleting.name}</span>?
            If this item appears in past orders, it will be deactivated instead of removed
            so reports stay accurate.
          </p>
          <StableModalFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void confirmDelete(deleting)}>Delete</Button>
          </StableModalFooter>
        </StableModal>
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
    image_url: item.image_url ?? "",
  });
  const [uploadingImage, setUploadingImage] = useState(false);
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
      image_url: f.image_url.trim() || null,
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

  async function uploadImage(file: File) {
    setUploadingImage(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `items/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await (supabase.storage.from("menu-images") as any).upload(path, file, {
        upsert: false, contentType: file.type || undefined,
      });
      if (upErr) throw upErr;
      const { data: pub } = (supabase.storage.from("menu-images") as any).getPublicUrl(path);
      const url = pub?.publicUrl ?? "";
      if (!url) throw new Error("No public URL returned");
      if (item.id) {
        const { error: saveErr } = await db.from("menu_items").update({ image_url: url }).eq("id", item.id);
        if (saveErr) throw saveErr;
      }
      setF((cur) => ({ ...cur, image_url: url }));
      toast.success(item.id ? "Image uploaded and saved" : "Image uploaded");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/bucket/i.test(msg) && /not found/i.test(msg)) {
        toast.error("Image bucket missing. Run supabase_phase36_schema.sql to create the 'menu-images' bucket.");
      } else {
        toast.error(`Upload failed: ${msg}`);
      }
    } finally {
      setUploadingImage(false);
    }
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
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Product image (shown on the customer ordering page)</label>
            <div className="flex items-start gap-3 mt-1">
              {f.image_url ? (
                <img src={f.image_url} alt="" className="h-20 w-20 rounded object-cover border" />
              ) : (
                <div className="h-20 w-20 rounded border border-dashed flex items-center justify-center text-[10px] text-muted-foreground text-center px-1">
                  No image
                </div>
              )}
              <div className="flex-1 space-y-2">
                <Input
                  type="file"
                  accept="image/*"
                  disabled={uploadingImage}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadImage(file);
                    e.currentTarget.value = "";
                  }}
                />
                {f.image_url && (
                  <Button type="button" size="sm" variant="ghost"
                    onClick={() => setF({ ...f, image_url: "" })}>
                    <Trash2 className="h-3 w-3 mr-1" /> Remove image
                  </Button>
                )}
                {uploadingImage && <div className="text-xs text-muted-foreground">Uploading…</div>}
              </div>
            </div>
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
// One item = a base row followed by detail rows:
//  - ingredient rows (variant blank)            -> recipe per serving of the item
//  - variant rows (variant + variant_price)      -> custom variant
//  - ingredient rows with variant filled         -> recipe per serving of that variant
//  - option rows (option_group/label/price)      -> customization options
//  - options_json on the base row keeps the full customization setup for exact re-import.
// Import updates only what the file contains: blank base fields keep current values,
// and recipes are only replaced for items/variants that have ingredient rows.
const MENU_CSV_COLS = [
  "product_code","name","category","owner","price","description","is_active","has_variants","sort_order",
  "variant","variant_price","variant_active",
  "ingredient","qty_per_unit","unit",
  "option_group","option_label","option_price","option_default",
  "options_json",
];

const EMPTY_SUB = {
  variant: "", variant_price: "", variant_active: "",
  ingredient: "", qty_per_unit: "", unit: "",
  option_group: "", option_label: "", option_price: "", option_default: "",
};
const EMPTY_BASE = {
  product_code: "", name: "", category: "", owner: "", price: "", description: "", is_active: "",
  has_variants: "", sort_order: "", options_json: "",
};
const truthy = (v: unknown) => /^(true|1|yes|y)$/i.test(String(v ?? "").trim());

function ImportExportButtons({
  items, exportItems, cats, owners, invs, recipes, variants, vrecipes, onImported,
}: {
  items: Item[]; exportItems: Item[]; cats: Cat[]; owners: Owner[]; invs: Inv[]; recipes: Recipe[];
  variants: Variant[]; vrecipes: VariantRecipe[]; onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  function handleExport() {
    const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "";
    const ownerName = (id: string | null) => owners.find((o) => o.id === id)?.name ?? "";
    const ingRow = (iid: string, qty: number, variant = "") => {
      const ing = invs.find((i) => i.id === iid);
      return { ...EMPTY_SUB, variant, ingredient: ing?.name ?? "", qty_per_unit: Number(qty), unit: ing?.unit ?? "" };
    };
    const rows: Record<string, any>[] = [];
    for (const it of exportItems) {
      const base = {
        product_code: it.product_code ?? "", name: it.name, category: catName(it.category_id),
        owner: ownerName(it.owner_id), price: Number(it.price), description: it.description ?? "",
        is_active: it.is_active ? "true" : "false", has_variants: it.has_variants ? "true" : "false",
        sort_order: it.sort_order, options_json: it.options ? JSON.stringify(it.options) : "",
      };
      const sub: Record<string, any>[] = [];
      for (const r of recipes.filter((r) => r.menu_item_id === it.id)) sub.push(ingRow(r.inventory_item_id, r.qty_per_unit));
      const vs = variants.filter((v) => v.menu_item_id === it.id).sort((a, b) => a.sort_order - b.sort_order);
      for (const v of vs) {
        sub.push({ ...EMPTY_SUB, variant: v.name, variant_price: Number(v.price), variant_active: v.is_active ? "true" : "false" });
        for (const r of vrecipes.filter((x) => x.variant_id === v.id)) sub.push(ingRow(r.inventory_item_id, r.qty_per_unit, v.name));
      }
      const o = it.options ?? {};
      const lists: Array<[string, any[]]> = [
        ["size", o.sizes ?? []], ["milk", o.milks ?? []], ["extra", o.extras ?? []],
        ["flavor", o.flavors ?? []], ["other", o.others ?? []],
        ...((o.groups ?? []).map((g) => [`group:${g.name}`, g.options ?? []] as [string, any[]])),
      ];
      for (const [group, list] of lists) for (const opt of list) sub.push({
        ...EMPTY_SUB, option_group: group, option_label: opt.label,
        option_price: Number(opt.price_delta) || 0, option_default: opt.is_default ? "true" : "",
      });
      for (const k of ["allow_other", "allow_notes", "size_required"] as const) {
        if (o[k]) sub.push({ ...EMPTY_SUB, option_group: "flag", option_label: k, option_price: "true" });
      }
      if (sub.length === 0) rows.push({ ...base, ...EMPTY_SUB });
      else sub.forEach((s, i) => rows.push({ ...(i === 0 ? base : EMPTY_BASE), ...s }));
    }
    downloadCsv(`menu-export-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, MENU_CSV_COLS));
    toast.success(`Exported ${exportItems.length} item(s) with variants and recipes`);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length === 0) return toast.error("CSV is empty");

      type VGroup = { price: string; active: string; ings: { name: string; qty: number }[]; seen: boolean };
      type Group = {
        base: Record<string, string>; ings: { name: string; qty: number }[];
        variants: Map<string, VGroup>; variantOrder: string[];
        lists: Record<string, any[]>; groups: Map<string, any[]>; flags: Record<string, boolean>; hasOptRows: boolean;
      };
      const groups = new Map<string, Group>();
      let lastName = "", lastCode = "";
      for (const r of parsed) {
        const rowCode = String(r.product_code ?? "").trim();
        const rowName = String(r.name ?? "").trim();
        if (rowCode || rowName) { lastCode = rowCode; lastName = rowName || (rowCode ? "" : lastName); }
        if (!lastName && !lastCode) continue;
        const key = (lastCode || lastName).toLowerCase();
        let g = groups.get(key);
        if (!g) {
          g = { base: { name: lastName, product_code: lastCode }, ings: [], variants: new Map(), variantOrder: [],
            lists: { size: [], milk: [], extra: [], flavor: [], other: [] }, groups: new Map(), flags: {}, hasOptRows: false };
          groups.set(key, g);
        }
        for (const k of Object.keys(EMPTY_BASE)) {
          const v = String(r[k] ?? "").trim();
          if (v && !g.base[k]) g.base[k] = v;
        }
        const vName = String(r.variant ?? "").trim();
        let vg: VGroup | undefined;
        if (vName) {
          vg = g.variants.get(vName.toLowerCase());
          if (!vg) { vg = { price: "", active: "", ings: [], seen: true }; g.variants.set(vName.toLowerCase(), vg); g.variantOrder.push(vName); }
          if (String(r.variant_price ?? "").trim()) vg.price = String(r.variant_price).trim();
          if (String(r.variant_active ?? "").trim()) vg.active = String(r.variant_active).trim();
        }
        const ingName = String(r.ingredient ?? "").trim();
        if (ingName && Number(r.qty_per_unit) > 0) {
          (vg ? vg.ings : g.ings).push({ name: ingName, qty: Number(r.qty_per_unit) });
        }
        const grp = String(r.option_group ?? "").trim();
        const lbl = String(r.option_label ?? "").trim();
        if (grp && lbl) {
          g.hasOptRows = true;
          const gl = grp.toLowerCase();
          if (gl === "flag") g.flags[lbl] = truthy(r.option_price || "true");
          else {
            const opt = { label: lbl, price_delta: Number(r.option_price) || 0, is_default: truthy(r.option_default) };
            if (gl.startsWith("group:")) {
              const n = grp.slice(6).trim();
              if (!g.groups.has(n)) g.groups.set(n, []);
              g.groups.get(n)!.push(opt);
            } else if (g.lists[gl]) g.lists[gl].push(opt);
          }
        }
      }

      const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
      const ownerByName = new Map(owners.map((o) => [o.name.toLowerCase(), o.id]));
      const invByName = new Map(invs.map((i) => [i.name.toLowerCase(), i.id]));
      const itemByName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
      const itemByCode = new Map(items.filter((i) => i.product_code).map((i) => [i.product_code!.toLowerCase(), i]));
      const toIng = (list: { name: string; qty: number }[], unknown: Set<string>) => {
        // Same ingredient listed twice -> quantities are added together.
        const m = new Map<string, number>();
        for (const x of list) {
          const iid = invByName.get(x.name.toLowerCase());
          if (!iid) { unknown.add(x.name); continue; }
          m.set(iid, (m.get(iid) ?? 0) + x.qty);
        }
        return [...m.entries()];
      };

      let created = 0, updated = 0, recipesSet = 0;
      const failed: string[] = [];
      const unknownIngs = new Set<string>();
      const unknownCats = new Set<string>();

      for (const [, g] of groups) {
        const b = g.base;
        const name = String(b.name ?? "").trim();
        const code = String(b.product_code ?? "").trim();
        const label = name || code;
        try {
          const existing = (code && itemByCode.get(code.toLowerCase())) || (name && itemByName.get(name.toLowerCase())) || null;
          const payload: any = {};
          if (name) payload.name = name;
          if (b.description) payload.description = b.description;
          if (b.price !== undefined && b.price !== "") payload.price = Number(b.price) || 0;
          if (b.category) {
            const cid = catByName.get(b.category.toLowerCase());
            if (cid) payload.category_id = cid; else unknownCats.add(b.category);
          }
          if (b.owner) {
            const oid = ownerByName.get(b.owner.toLowerCase());
            if (oid) payload.owner_id = oid;
          }
          if (b.is_active) payload.is_active = truthy(b.is_active);
          if (b.sort_order) payload.sort_order = Number(b.sort_order) || 0;
          if (b.has_variants) payload.has_variants = truthy(b.has_variants);
          else if (g.variants.size > 0) payload.has_variants = true;
          let opts: MenuOptions | null = null;
          if (b.options_json) { try { opts = JSON.parse(b.options_json); } catch { opts = null; } }
          if (!opts && g.hasOptRows) {
            opts = {
              ...emptyOptions(), sizes: g.lists.size, milks: g.lists.milk, extras: g.lists.extra,
              flavors: g.lists.flavor, others: g.lists.other,
              groups: [...g.groups.entries()].map(([n, options]) => ({ name: n, select: "multi" as const, options })),
              allow_other: g.flags.allow_other ?? false, allow_notes: g.flags.allow_notes ?? false,
              size_required: g.flags.size_required ?? false,
              upsell_item_ids: existing?.options?.upsell_item_ids ?? [],
            };
          }
          if (opts) payload.options = opts;

          let id: string;
          if (existing) {
            if (Object.keys(payload).length) {
              const { error } = await db.from("menu_items").update(payload).eq("id", existing.id);
              if (error) throw error;
            }
            id = existing.id; updated++;
          } else {
            if (!name) throw new Error("new item needs a name");
            const ins = { price: 0, is_active: true, options: emptyOptions(), sort_order: items.length + created + 1, ...payload, ...(code ? { product_code: code } : {}) };
            const { data, error } = await db.from("menu_items").insert(ins).select("id").single();
            if (error) throw error;
            id = data.id; created++;
          }

          if (g.ings.length) {
            const list = toIng(g.ings, unknownIngs);
            await db.from("recipes").delete().eq("menu_item_id", id);
            if (list.length) {
              const { error } = await db.from("recipes").insert(list.map(([iid, q]) => ({ menu_item_id: id, inventory_item_id: iid, qty_per_unit: q })));
              if (error) throw error;
            }
            recipesSet++;
          }

          if (g.variants.size) {
            const curVs = variants.filter((v) => v.menu_item_id === id);
            for (let i = 0; i < g.variantOrder.length; i++) {
              const vName = g.variantOrder[i];
              const vg = g.variants.get(vName.toLowerCase())!;
              const cur = curVs.find((v) => v.name.toLowerCase() === vName.toLowerCase());
              let vid: string;
              const vp: any = {};
              if (vg.price !== "") vp.price = Number(vg.price) || 0;
              if (vg.active !== "") vp.is_active = truthy(vg.active);
              if (cur) {
                vid = cur.id;
                if (Object.keys(vp).length) {
                  const { error } = await db.from("menu_item_variants").update(vp).eq("id", vid);
                  if (error) throw error;
                }
              } else {
                const { data, error } = await db.from("menu_item_variants")
                  .insert({ menu_item_id: id, name: vName, price: 0, is_active: true, sort_order: curVs.length + i + 1, ...vp })
                  .select("id").single();
                if (error) throw error;
                vid = data.id;
              }
              if (vg.ings.length) {
                const list = toIng(vg.ings, unknownIngs);
                await db.from("variant_recipes").delete().eq("variant_id", vid);
                if (list.length) {
                  const { error } = await db.from("variant_recipes").insert(list.map(([iid, q]) => ({ variant_id: vid, inventory_item_id: iid, qty_per_unit: q })));
                  if (error) throw error;
                }
                recipesSet++;
              }
            }
          }
        } catch (err: any) {
          failed.push(`${label}: ${err?.message ?? err}`);
        }
      }

      const notes: string[] = [];
      if (unknownIngs.size) notes.push(`Unknown ingredients skipped: ${[...unknownIngs].join(", ")}`);
      if (unknownCats.size) notes.push(`Unknown categories ignored: ${[...unknownCats].join(", ")}`);
      if (failed.length) notes.push(`Failed: ${failed.slice(0, 5).join("; ")}${failed.length > 5 ? ` (+${failed.length - 5} more)` : ""}`);
      const msg = `Import done: ${created} new, ${updated} updated, ${recipesSet} recipe(s) replaced`;
      if (notes.length) toast.warning(msg, { description: notes.join("\n"), duration: 15000 });
      else toast.success(msg);
      onImported();
    } catch (err: any) {
      toast.error(`Import failed: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleExport}>
        <Download className="h-3 w-3 mr-1" /> Export CSV
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Upload className="h-3 w-3 mr-1" /> {busy ? "Importing…" : "Import CSV"}
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
