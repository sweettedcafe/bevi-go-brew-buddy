import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { QrCanvas, BarcodeSvg } from "@/components/customers/CodeRenderers";
import { Coffee, Mail } from "lucide-react";

export const Route = createFileRoute("/register")({ component: RegisterPage });

const db = supabase as any;

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}
function isValidPhone(p: string) {
  // require at least 7 digits (loose international)
  return (p.match(/\d/g)?.length ?? 0) >= 7;
}

function RegisterPage() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; token: string; existed: boolean } | null>(null);
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function submit() {
    if (!name.trim()) { toast.error("Please enter your name"); return; }
    if (!isValidPhone(phone)) { toast.error("A valid mobile number is required"); return; }
    if (!isValidEmail(email)) { toast.error("A valid email address is required"); return; }
    setBusy(true);
    const { data, error } = await db.rpc("customer_self_register", {
      p_name: name, p_phone: phone, p_email: email,
    });
    if (error) { setBusy(false); toast.error(error.message); return; }
    const r = data as any;
    setResult(r);

    // Fire welcome email (non-blocking UX; show status)
    setEmailStatus("sending");
    try {
      const url = `${window.location.origin}/o/${r.token}`;
      const res = await fetch("/api/public/send-welcome-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          code: r.code,
          order_url: url,
        }),
      });
      if (res.ok) setEmailStatus("sent");
      else setEmailStatus("failed");
    } catch {
      setEmailStatus("failed");
    }
    setBusy(false);
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
          <div className="text-xs inline-flex items-center gap-1 justify-center text-muted-foreground">
            <Mail className="h-3 w-3" />
            {emailStatus === "sending" && "Sending a copy to your email…"}
            {emailStatus === "sent" && "We've emailed you a copy of your QR."}
            {emailStatus === "failed" && "Couldn't send email — please save this QR."}
            {emailStatus === "idle" && ""}
          </div>
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
        <div><Label>Mobile number *</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxxx" inputMode="tel" /></div>
        <div><Label>Email *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
        <p className="text-[11px] text-muted-foreground">
          We'll email you a copy of your QR code so you can order any time.
        </p>
        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? "Registering…" : "Register"}
        </Button>
      </Card>
    </div>
  );
}
