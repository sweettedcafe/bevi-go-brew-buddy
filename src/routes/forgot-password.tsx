import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logo from "@/assets/bevi-logo.jpg";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    if (password.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    if (password !== confirm) { toast.error("Passwords do not match."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/public/reset-password-by-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, new_password: password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        const err = body?.error ?? res.status;
        if (err === "user_not_found") throw new Error("No account found with that email.");
        throw new Error(`${err}${body?.detail ? " — " + body.detail : ""}`);
      }
      toast.success("Password updated. Please sign in with your new password.");
      setTimeout(() => navigate({ to: "/login" }), 900);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-12">
        <img src={logo} alt="Bevi & Go" className="h-10 w-auto bg-background rounded-md p-1.5 self-start" />
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-sidebar-foreground/60 mb-4">Password recovery</p>
          <h2 className="text-4xl font-display leading-tight">
            Reset your <span className="italic text-primary">password</span>
          </h2>
          <p className="mt-4 text-sm text-sidebar-foreground/70 max-w-md">
            Enter your account email and choose a new password.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© Bevi &amp; Go</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <img src={logo} alt="Bevi & Go" className="h-9 w-auto mx-auto mb-8 lg:hidden" />
          <h1 className="text-3xl font-display mb-1">Reset password</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Enter your email and a new password.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" type="password" required minLength={6}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Confirm password</Label>
              <Input id="pw2" type="password" required minLength={6}
                value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            <Link to="/login" className="text-muted-foreground hover:text-foreground">
              ← Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
