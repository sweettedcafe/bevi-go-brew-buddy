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
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
  category_id: string | null;
  sort_order: number;
  options: MenuOptions | null;
};
type Cat = { id: string; name: string };
type Inv = { id: string; name: string; unit: string; is_active: boolean };
type Recipe = { menu_item_id: string; inventory_item_id: string; qty_per_unit: number };

const db = supabase as any;

function MenuPage() {
  const { primaryRole } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [items, setItems] = useState<Item[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [invs, setInvs] = useState<Inv[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Item | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: m }, { data: c }, { data: i }, { data: r }] = await Promise.all([
      db.from("menu_items").select("*").order("sort_order"),
      db.from("categories").select("id,name").order("sort_order"),
      db.from("inventory_items").select("id,name,unit,is_active").order("name"),
      db.from("recipes").select("*"),
    ]);
    setItems((m ?? []) as Item[]);
    setCats((c ?? []) as Cat[]);
    setInvs((i ?? []) as Inv[]);
    setRecipes((r ?? []) as Recipe[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";
  const itemRecipes = (id: string) => recipes.filter((r) => r.menu_item_id === id);
  const invName = (id: string) => invs.find((i) => i.id === id);

  async function toggleActive(it: Item) {
    const { error } = await db.from("menu_items")
      .update({ is_active: !it.is_active }).eq("id", it.id);
    if (error) return toast.error(error.message);
    toast.success(`${it.name} ${!it.is_active ? "activated" : "deactivated"}`);
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
            <ImportExportButtons
              items={items} cats={cats} invs={invs} recipes={recipes}
              onImported={() => void load()}
            />
            <Button size="sm" onClick={() => setEditing({
              id: "", name: "", description: "", price: 0,
              is_active: true, category_id: cats[0]?.id ?? null, sort_order: items.length + 1,
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
            return (
              <Card key={it.id} className={`p-4 ${!it.is_active ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{it.name}</span>
                      <Badge variant="secondary">{catName(it.category_id)}</Badge>
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
                    {rs.length > 0 && (
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
                    )}
                  </div>
                  <div className="font-display text-lg text-primary">{Number(it.price).toFixed(2)}</div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <Switch checked={it.is_active} onCheckedChange={() => toggleActive(it)} />
                      <Button size="icon" variant="ghost" onClick={() => setEditing(it)}>
                        <Pencil className="h-3.5 w-3.5" />
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
          invs={invs}
          initialRecipes={editing.id ? itemRecipes(editing.id) : []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function EditMenuDialog({
  item, cats, invs, initialRecipes, onClose, onSaved,
}: {
  item: Item;
  cats: Cat[];
  invs: Inv[];
  initialRecipes: Recipe[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: item.name,
    description: item.description ?? "",
    price: String(item.price),
    category_id: item.category_id ?? "",
    is_active: item.is_active,
    sort_order: String(item.sort_order),
  });
  const [rcs, setRcs] = useState<Array<{ inventory_item_id: string; qty: string }>>(
    initialRecipes.map((r) => ({ inventory_item_id: r.inventory_item_id, qty: String(r.qty_per_unit) })),
  );
  const [options, setOptions] = useState<MenuOptions>(
    (item.options && typeof item.options === "object") ? item.options : emptyOptions(),
  );
  const [saving, setSaving] = useState(false);
  const activeInvs = useMemo(() => invs.filter((i) => i.is_active), [invs]);

  async function save() {
    if (!f.name.trim()) return toast.error("Name required");
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      price: Number(f.price) || 0,
      category_id: f.category_id || null,
      is_active: f.is_active,
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
    // Replace recipes
    await db.from("recipes").delete().eq("menu_item_id", id);
    const validRcs = rcs
      .filter((r) => r.inventory_item_id && Number(r.qty) > 0)
      .map((r) => ({ menu_item_id: id, inventory_item_id: r.inventory_item_id, qty_per_unit: Number(r.qty) }));
    if (validRcs.length > 0) {
      const { error } = await db.from("recipes").insert(validRcs);
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    setSaving(false);
    toast.success("Saved");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.id ? "Edit menu item" : "New menu item"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Description</label>
            <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Price</label>
            <Input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </div>
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
            <label className="text-xs text-muted-foreground">Sort order</label>
            <Input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 mt-5">
            <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
            <span className="text-sm">Active (visible in POS)</span>
          </div>
        </div>

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
                    <Input className="w-24" type="number" placeholder="qty"
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

        <div className="mt-4 border-t pt-3">
          <h3 className="font-medium text-sm mb-2">Customization options</h3>
          <MenuOptionsEditor value={options} onChange={setOptions} />
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
  "name","category","price","description","is_active","sort_order","ingredient","qty_per_unit","unit",
];

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
        name: it.name,
        category: catName(it.category_id),
        price: it.price,
        description: it.description ?? "",
        is_active: it.is_active ? "true" : "false",
        sort_order: it.sort_order,
      };
      if (rcs.length === 0) {
        rows.push({ ...base, ingredient: "", qty_per_unit: "", unit: "" });
      } else {
        rcs.forEach((r) => {
          const ing = invs.find((i) => i.id === r.inventory_item_id);
          rows.push({
            ...base,
            ingredient: ing?.name ?? "",
            qty_per_unit: r.qty_per_unit,
            unit: ing?.unit ?? "",
          });
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
      const missing = MENU_CSV_COLS.filter((c) => !(c in parsed[0]));
      if (missing.length === MENU_CSV_COLS.length) return toast.error("CSV is missing required columns");

      // Group rows by item name
      const groups = new Map<string, { base: any; ings: { name: string; qty: number }[] }>();
      for (const r of parsed) {
        const name = String(r.name ?? "").trim();
        if (!name) continue;
        const g = groups.get(name) ?? { base: r, ings: [] };
        if (r.ingredient && String(r.ingredient).trim() && Number(r.qty_per_unit) > 0) {
          g.ings.push({ name: String(r.ingredient).trim(), qty: Number(r.qty_per_unit) });
        }
        groups.set(name, g);
      }

      const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
      const invByName = new Map(invs.map((i) => [i.name.toLowerCase(), i.id]));
      const itemByName = new Map(items.map((i) => [i.name.toLowerCase(), i]));

      let created = 0, updated = 0, skipped = 0;
      const unknownIngs = new Set<string>();

      for (const [name, g] of groups) {
        const catId = catByName.get(String(g.base.category ?? "").toLowerCase()) ?? null;
        const payload = {
          name,
          description: String(g.base.description ?? "").trim() || null,
          price: Number(g.base.price) || 0,
          category_id: catId,
          is_active: /^(true|1|yes)$/i.test(String(g.base.is_active ?? "true")),
          sort_order: Number(g.base.sort_order) || 0,
        };
        const existing = itemByName.get(name.toLowerCase());
        let id: string;
        if (existing) {
          const { error } = await db.from("menu_items").update(payload).eq("id", existing.id);
          if (error) { skipped++; continue; }
          id = existing.id;
          updated++;
        } else {
          const { data, error } = await db.from("menu_items").insert(payload).select("id").single();
          if (error) { skipped++; continue; }
          id = data.id;
          created++;
        }
        // Replace recipes
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
