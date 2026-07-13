import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Users, QrCode, Plus, Search, Star, Printer, Save, ExternalLink, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { QrCanvas, BarcodeSvg } from "@/components/customers/CodeRenderers";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

const db = supabase as any;

type Customer = {
  id: string; code: string; token: string;
  name: string; phone: string | null; email: string | null;
  points: number; is_active: boolean; created_at: string;
  deleted_at?: string | null;
};
type Loyalty = {
  is_active: boolean; earn_rate: number;
  redeem_threshold: number; redeem_value: number;
};

function CustomersPage() {
  const { hasRole } = useAuth();
  const isDev = hasRole("developer");
  const [list, setList] = useState<Customer[]>([]);
  const [deletedList, setDeletedList] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<Customer | null>(null);
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: c }, { data: l }] = await Promise.all([
      db.from("customers").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      db.from("loyalty_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    setList((c ?? []) as Customer[]);
    if (l) setLoyalty(l as Loyalty);
    if (isDev) {
      const { data: d } = await db.rpc("dev_list_deleted_customers");
      setDeletedList((d ?? []) as Customer[]);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function restoreCustomer(id: string) {
    const { error } = await db.rpc("dev_restore_customer", { p_id: id });
    if (error) { toast.error(error.message); return; }
    toast.success("Customer restored");
    load();
  }

  const filtered = q.trim()
    ? list.filter((c) =>
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.code.includes(q) ||
        (c.phone ?? "").includes(q))
    : list;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Customers & Loyalty</h1>
        <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
          <Plus className="h-3 w-3 mr-1" /> Add customer
        </Button>
      </header>

      {loyalty && <LoyaltyCard loyalty={loyalty} onSaved={load} />}

      <RegisterQrCard />

      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="font-display text-lg">Registered customers</div>
          <Badge variant="secondary">{list.length}</Badge>
          <a href="/register" target="_blank" className="ml-auto text-xs underline text-primary inline-flex items-center gap-1">
            Public register link <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="relative mb-3 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, phone or code" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No customers yet.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((c) => (
              <button key={c.id} onClick={() => setDetail(c)}
                className="text-left rounded-md border p-3 hover:bg-accent transition-colors">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate flex-1">{c.name}</div>
                  <div className="inline-flex items-center text-xs gap-1 text-primary">
                    <Star className="h-3 w-3 fill-current" /> {c.points}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {c.phone ?? "—"} · code {c.code}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {isDev && deletedList.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <Trash2 className="h-4 w-4 text-muted-foreground" />
            <div className="font-display text-lg">Deleted customers</div>
            <Badge variant="secondary">{deletedList.length}</Badge>
            <span className="ml-auto text-xs text-muted-foreground">Developer-only · can be restored</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {deletedList.map((c) => (
              <div key={c.id} className="rounded-md border p-3 bg-muted/40">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {c.phone ?? "—"} · code {c.code}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Deleted {c.deleted_at ? new Date(c.deleted_at).toLocaleString() : "—"}
                </div>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => restoreCustomer(c.id)}>
                  <Undo2 className="h-3 w-3 mr-1" /> Restore
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {adding && (
        <RegisterDialog onClose={(created) => { setAdding(false); if (created) load(); }} />
      )}
      {detail && (
        <CustomerDetailDialog customer={detail} onClose={(changed) => { setDetail(null); if (changed) load(); }} />
      )}
    </div>
  );
}

function LoyaltyCard({ loyalty, onSaved }: { loyalty: Loyalty; onSaved: () => void }) {
  const [l, setL] = useState(loyalty);
  const [saving, setSaving] = useState(false);
  useEffect(() => setL(loyalty), [loyalty]);
  async function save() {
    setSaving(true);
    const { error } = await db.from("loyalty_settings").update({
      is_active: l.is_active,
      earn_rate: Number(l.earn_rate) || 0,
      redeem_threshold: Number(l.redeem_threshold) || 0,
      redeem_value: Number(l.redeem_value) || 0,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Loyalty settings saved");
    onSaved();
  }
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Star className="h-4 w-4 text-primary" />
        <div className="font-display text-lg">Loyalty rewards</div>
        <Switch className="ml-auto" checked={l.is_active}
          onCheckedChange={(v) => setL({ ...l, is_active: v })} />
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Points earned per ₱1 spent</Label>
          <Input type="number" step="0.01" value={l.earn_rate}
            onChange={(e) => setL({ ...l, earn_rate: Number(e.target.value) })} />
        </div>
        <div>
          <Label className="text-xs">Points per redemption</Label>
          <Input type="number" value={l.redeem_threshold}
            onChange={(e) => setL({ ...l, redeem_threshold: Number(e.target.value) })} />
        </div>
        <div>
          <Label className="text-xs">Peso value per redemption</Label>
          <Input type="number" step="0.01" value={l.redeem_value}
            onChange={(e) => setL({ ...l, redeem_value: Number(e.target.value) })} />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Example: at {l.earn_rate} pt/₱, a ₱150 order earns {Math.floor(150 * Number(l.earn_rate))} pts.
        Redeem {l.redeem_threshold} pts for ₱{Number(l.redeem_value).toFixed(2)} off.
      </div>
      <div><Button size="sm" onClick={save} disabled={saving}><Save className="h-3 w-3 mr-1" />Save</Button></div>
    </Card>
  );
}

function RegisterDialog({ onClose }: { onClose: (created: boolean) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!name.trim()) { toast.error("Name required"); return; }
    setBusy(true);
    const { error } = await db.rpc("customer_self_register", {
      p_name: name, p_phone: phone, p_email: email,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Customer added");
    onClose(true);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add customer</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label className="text-xs">Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><Label className="text-xs">Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDetailDialog({ customer, onClose }: { customer: Customer; onClose: (changed: boolean) => void }) {
  const { hasRole } = useAuth();
  const canDelete = hasRole("admin") || hasRole("developer");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const orderUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/o/${customer.token}`;

  async function deleteCustomer() {
    if (!confirm(`Delete customer "${customer.name}"? A developer can restore it later.`)) return;
    setDeleting(true);
    const { error } = await db.rpc("admin_delete_customer", { p_id: customer.id });
    setDeleting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Customer deleted");
    onClose(true);
  }

  useEffect(() => {
    (async () => {
      const { data: r } = await db.rpc("customer_lookup", { p_code: customer.code });
      setData(r);
      setLoading(false);
    })();
  }, [customer.code]);

  function printCard() {
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return;
    w.document.write(`
      <html><head><title>${customer.name}</title>
      <style>body{font-family:system-ui;padding:20px;text-align:center}</style></head>
      <body>
        <h2>${customer.name}</h2>
        <p>Customer code: <b>${customer.code}</b></p>
        <p style="margin:8px 0 4px;font-size:12px;color:#666">Scan to identify customer</p>
        <div id="bc" style="display:flex;justify-content:center"></div>
        <p style="margin-top:24px">Scan to order:</p>
        <div id="qr" style="display:flex;justify-content:center"></div>
        <p style="font-size:11px;color:#666">${orderUrl}</p>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1/build/qrcode.min.js"></script>
        <script>
          QRCode.toCanvas(document.createElement('canvas'),'${customer.code}',{width:180,margin:1},(err,c)=>{document.getElementById('bc').appendChild(c)});
          QRCode.toCanvas(document.createElement('canvas'),'${orderUrl}',{width:200,margin:1},(err,c)=>{document.getElementById('qr').appendChild(c)});
          setTimeout(()=>window.print(),500);
        </script>
      </body></html>`);
    w.document.close();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{customer.name}</DialogTitle></DialogHeader>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {customer.phone ?? "—"}{customer.email ? ` · ${customer.email}` : ""}
            </div>
            <div className="rounded border p-3 text-center">
              <div className="text-xs text-muted-foreground">Loyalty points</div>
              <div className="font-display text-3xl text-primary">{data?.points ?? customer.points}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground mb-1">Recent orders</div>
              {loading ? <div className="text-xs">Loading…</div>
                : (data?.recent_orders?.length ?? 0) === 0 ? <div className="text-xs">None yet.</div>
                : <ul className="space-y-1 text-sm max-h-40 overflow-auto">
                    {data.recent_orders.map((o: any) => (
                      <li key={o.id} className="flex justify-between">
                        <span>#{String(o.order_no).padStart(3,"0")} · {new Date(o.created_at).toLocaleDateString()}</span>
                        <span className="text-muted-foreground">₱{Number(o.total).toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>}
            </div>
          </div>
          <div className="space-y-3 text-center">
            <div className="text-xs text-muted-foreground">QR code (barista scans)</div>
            <div className="flex justify-center"><BarcodeSvg value={customer.code} /></div>
            <div className="text-xs text-muted-foreground mt-2">QR (customer scans to order)</div>
            <div className="flex justify-center"><QrCanvas value={orderUrl} size={180} /></div>
            <div className="text-[10px] text-muted-foreground break-all">{orderUrl}</div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {canDelete && (
            <Button variant="destructive" onClick={deleteCustomer} disabled={deleting} className="mr-auto">
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={printCard}><Printer className="h-3 w-3 mr-1" />Print card</Button>
          <Button onClick={() => onClose(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegisterQrCard() {
  const url = typeof window !== "undefined" ? `${window.location.origin}/welcome` : "/welcome";
  function printPoster() {
    const w = window.open("", "_blank", "width=500,height=700");
    if (!w) return;
    w.document.write(`
      <html><head><title>Bevi & Go — Scan to Order</title>
      <style>body{font-family:system-ui;padding:32px;text-align:center}h1{margin:0 0 8px}p{color:#555}</style></head>
      <body>
        <h1>Scan to Order</h1>
        <p>Registered? Enter your email to jump to ordering.<br/>New? We'll sign you up in seconds.</p>
        <div id="qr" style="display:flex;justify-content:center;margin:24px 0"></div>
        <p style="font-size:12px;color:#888">${url}</p>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1/build/qrcode.min.js"></script>
        <script>
          QRCode.toCanvas(document.createElement('canvas'),'${url}',{width:320},(err,c)=>{document.getElementById('qr').appendChild(c)});
          setTimeout(()=>window.print(),500);
        </script>
      </body></html>`);
    w.document.close();
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-shrink-0">
          <QrCanvas value={url} size={140} />
        </div>
        <div className="flex-1 min-w-[200px] space-y-1">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-primary" />
            <div className="font-display text-lg">Walk-in ordering QR</div>
          </div>
          <p className="text-sm text-muted-foreground">
            Display this QR in-store. Customers scan it, enter their email, and are taken straight
            to their ordering page — new customers are routed to registration first.
          </p>
          <div className="text-xs text-muted-foreground break-all">{url}</div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={printPoster}>
              <Printer className="h-3 w-3 mr-1" /> Print poster
            </Button>
            <a href="/welcome" target="_blank">
              <Button size="sm" variant="outline">
                <ExternalLink className="h-3 w-3 mr-1" /> Open page
              </Button>
            </a>
          </div>

        </div>
      </div>
    </Card>
  );
}
