import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { QrCanvas, BarcodeSvg } from "@/components/customers/CodeRenderers";
import { Coffee } from "lucide-react";

export const Route = createFileRoute("/register")({ component: RegisterPage });

const db = supabase as any;

function RegisterPage() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; token: string; existed: boolean } | null>(null);

  async function submit() {
    if (!name.trim()) { toast.error("Please enter your name"); return; }
    setBusy(true);
    const { data, error } = await db.rpc("customer_self_register", {
      p_name: name, p_phone: phone, p_email: email,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setResult(data as any);
  }

  if (result) {
    const url = `${window.location.origin}/o/${result.token}`;
    return (
      <div className="min-h-screen bg-background p-4 flex items-center justify-center">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <Coffee className="h-8 w-8 text-primary mx-auto" />
          <h1 className="font-display text-2xl">
            {result.existed ? "Welcome back!" : "You're in!"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Save this QR — scan it next time to pre-order and earn loyalty points.
          </p>
          <div className="flex justify-center"><QrCanvas value={url} size={220} /></div>
          <div className="text-xs text-muted-foreground">Your code</div>
          <div className="flex justify-center"><BarcodeSvg value={result.code} /></div>
          <Button className="w-full" onClick={() => nav({ to: `/o/${result.token}` as any })}>
            Start ordering
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <Card className="max-w-md w-full p-6 space-y-4">
        <div className="text-center">
          <Coffee className="h-8 w-8 text-primary mx-auto" />
          <h1 className="font-display text-2xl mt-2">Join Bevi & Go Rewards</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Earn points on every order. Redeem for discounts.
          </p>
        </div>
        <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxxx" /></div>
        <div><Label>Email (optional)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? "Registering…" : "Register"}
        </Button>
      </Card>
    </div>
  );
}
