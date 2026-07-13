import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Coffee } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/welcome")({ component: WelcomePage });

const db = supabase as any;

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

function WelcomePage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const e = email.trim();
    if (!isValidEmail(e)) {
      toast.error("Please enter a valid email address");
      return;
    }
    setBusy(true);
    const { data, error } = await db.rpc("customer_token_by_email", { p_email: e });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const r = data as { found: boolean; token?: string; name?: string };
    if (r?.found && r.token) {
      if (r.name) toast.success(`Welcome back, ${r.name}!`);
      nav({ to: `/o/${r.token}` as any });
    } else {
      toast.message("Let's get you registered");
      nav({ to: `/register?email=${encodeURIComponent(e)}` as any });
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <Card className="max-w-md w-full p-6 space-y-4">
        <div className="text-center">
          <Coffee className="h-8 w-8 text-primary mx-auto" />
          <h1 className="font-display text-2xl mt-2">Welcome to Bevi & Go</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your email to continue. New here? We'll help you sign up.
          </p>
        </div>
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            autoFocus
          />
        </div>
        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center">
          Registered customers will be taken straight to ordering.
        </p>
      </Card>
    </div>
  );
}
