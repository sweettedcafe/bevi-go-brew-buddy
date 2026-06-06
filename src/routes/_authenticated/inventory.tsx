import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Upload, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/inventory")({
  component: InventoryPage,
});

type Inv = {
  id: string;
  name: string;
  unit: string;
  stock_qty: number;
  low_threshold: number;
  pack_size: number;
  pack_label: string | null;
  full_stock_qty: number | null;
  cost_per_unit: number;
  is_active: boolean;
};

const db = supabase as any;

function pctOf(it: Inv) {
  const full = Number(it.full_stock_qty) || Math.max(Number(it.low_threshold) * 5, 1);
  const v = (Number(it.stock_qty) / full) * 100;
  return Math.max(0, Math.min(100, v));
}
function stateOf(it: Inv): "ok" | "low" | "critical" {
  const p = pctOf(it);
  if (Number(it.stock_qty) <= Number(it.low_threshold)) return "critical";
  if (p <= 40) return "low";
  return "ok";
}

function InventoryPage() {
  const { primaryRole } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [rows, setRows] = useState<Inv[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Inv | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await db.from("inventory_items").select("*").order("name");
    setRows((data ?? []) as Inv[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const visible = useMemo(
    () => rows.filter((r) => showInactive || r.is_active),
    [rows, showInactive],
  );
  const needRestock = useMemo(
    () => rows.filter((r) => r.is_active && stateOf(r) !== "ok"),
    [rows],
  );

  async function toggleActive(it: Inv) {
    const { error } = await db.from("inventory_items")
      .update({ is_active: !it.is_active }).eq("id", it.id);
    if (error) return toast.error(error.message);
    toast.success(`${it.name} ${!it.is_active ? "activated" : "deactivated"}`);
    void load();
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-display">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Pack-based stock. Auto-deducts on completed POS orders.
          </p>
        </div>
        {isAdmin && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Switch checked={showInactive} onCheckedChange={setShowInactive} id="si" />
              <label htmlFor="si" className="text-muted-foreground">Show inactive</label>
            </div>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-3 w-3 mr-1" /> Import
            </Button>
            <Button size="sm" onClick={() => setEditing({
              id: "", name: "", unit: "pcs", stock_qty: 0, low_threshold: 0,
              pack_size: 1, pack_label: "", full_stock_qty: 0, cost_per_unit: 0, is_active: true,
            })}>
              <Plus className="h-3 w-3 mr-1" /> New
            </Button>
          </>
        )}
      </div>

      {/* Restock summary */}
      {needRestock.length > 0 && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h2 className="font-medium">Needs restock ({needRestock.length})</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            {needRestock.map((r) => (
              <div key={r.id} className="flex justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {Number(r.stock_qty).toLocaleString()} / {Number(r.full_stock_qty || 0).toLocaleString()} {r.unit}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="text-muted-foreground text-sm">No inventory items.</div>
      ) : (
        <div className="grid gap-2">
          {visible.map((r) => {
            const s = stateOf(r);
            const color =
              s === "critical" ? "bg-destructive"
              : s === "low" ? "bg-amber-500"
              : "bg-emerald-500";
            return (
              <Card key={r.id} className={`p-4 ${!r.is_active ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{r.name}</span>
                      {r.pack_label && <Badge variant="secondary">{r.pack_label}</Badge>}
                      {!r.is_active && <Badge variant="outline">inactive</Badge>}
                      {s === "critical" && <Badge variant="destructive">restock</Badge>}
                      {s === "low" && <Badge className="bg-amber-500 text-white hover:bg-amber-500">low</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      pack {Number(r.pack_size)} {r.unit} · threshold {Number(r.low_threshold)} {r.unit}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display text-lg">
                      {Number(r.stock_qty).toLocaleString()}
                      <span className="text-sm text-muted-foreground"> / {Number(r.full_stock_qty || 0).toLocaleString()} {r.unit}</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} />
                      <Button size="icon" variant="ghost" onClick={() => setEditing(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 relative">
                  <Progress value={pctOf(r)} className="h-2" />
                  <div
                    className={`absolute inset-y-0 left-0 ${color} rounded-full transition-all`}
                    style={{ width: `${pctOf(r)}%`, height: "0.5rem" }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <EditInventoryDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
      {importOpen && (
        <ImportDialog onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); void load(); }} />
      )}
    </div>
  );
}

function EditInventoryDialog({
  item, onClose, onSaved,
}: { item: Inv; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: item.name, unit: item.unit, pack_size: String(item.pack_size),
    pack_label: item.pack_label ?? "",
    stock_qty: String(item.stock_qty),
    low_threshold: String(item.low_threshold),
    full_stock_qty: String(item.full_stock_qty ?? ""),
    cost_per_unit: String(item.cost_per_unit ?? 0),
    is_active: item.is_active,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.name.trim()) return toast.error("Name required");
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      unit: f.unit.trim() || "pcs",
      pack_size: Number(f.pack_size) || 1,
      pack_label: f.pack_label.trim() || null,
      stock_qty: Number(f.stock_qty) || 0,
      low_threshold: Number(f.low_threshold) || 0,
      full_stock_qty: Number(f.full_stock_qty) || Number(f.stock_qty) || 1,
      cost_per_unit: Number(f.cost_per_unit) || 0,
      is_active: f.is_active,
    };
    const { error } = item.id
      ? await db.from("inventory_items").update(payload).eq("id", item.id)
      : await db.from("inventory_items").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item.id ? "Edit ingredient" : "New ingredient"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Unit (g, ml, pcs)</label>
            <Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Pack size (per pack)</label>
            <Input type="number" value={f.pack_size} onChange={(e) => setF({ ...f, pack_size: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Pack label (e.g. "1L Bottle")</label>
            <Input value={f.pack_label} onChange={(e) => setF({ ...f, pack_label: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Current stock</label>
            <Input type="number" value={f.stock_qty} onChange={(e) => setF({ ...f, stock_qty: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Full stock target</label>
            <Input type="number" value={f.full_stock_qty} onChange={(e) => setF({ ...f, full_stock_qty: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Low threshold</label>
            <Input type="number" value={f.low_threshold} onChange={(e) => setF({ ...f, low_threshold: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Cost / unit</label>
            <Input type="number" value={f.cost_per_unit} onChange={(e) => setF({ ...f, cost_per_unit: e.target.value })} />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
            <span className="text-sm">Active</span>
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

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      let text = csv;
      if (mode === "url") {
        if (!url.trim()) throw new Error("Paste a CSV / published Google Sheet URL");
        // Convert standard Google Sheets edit URL → CSV export URL
        let u = url.trim();
        const m = u.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (m && !u.includes("output=csv")) {
          const gidMatch = u.match(/[#&?]gid=(\d+)/);
          const gid = gidMatch ? gidMatch[1] : "0";
          u = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
        }
        const res = await fetch(u);
        if (!res.ok) throw new Error("Could not fetch sheet. Make sure it is shared as 'Anyone with link'.");
        text = await res.text();
      }
      const rows = parseCSV(text);
      if (rows.length === 0) throw new Error("No rows parsed");
      const { data, error } = await db.rpc("inventory_import", { p_payload: { rows } });
      if (error) throw new Error(error.message);
      const r = data as { added: number; updated: number };
      toast.success(`Imported: ${r.added} added, ${r.updated} updated`);
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import inventory</DialogTitle>
          <DialogDescription>
            Columns: <code>name, unit, pack_size, pack_label, stock_qty, low_threshold, full_stock_qty, cost_per_unit</code>.
            Existing items: <b>stock_qty is appended</b>; other fields overwrite.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 mb-2">
          <Button size="sm" variant={mode === "url" ? "default" : "outline"} onClick={() => setMode("url")}>Google Sheet URL</Button>
          <Button size="sm" variant={mode === "paste" ? "default" : "outline"} onClick={() => setMode("paste")}>Paste CSV</Button>
        </div>
        {mode === "url" ? (
          <Input placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
            value={url} onChange={(e) => setUrl(e.target.value)} />
        ) : (
          <Textarea rows={8} placeholder="name,unit,pack_size,pack_label,stock_qty,low_threshold,full_stock_qty,cost_per_unit"
            value={csv} onChange={(e) => setCsv(e.target.value)} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={go} disabled={busy}>{busy ? "Importing…" : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const split = (l: string) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i+1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => {
    const cells = split(l);
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = cells[i] ?? ""; });
    return o;
  });
}
