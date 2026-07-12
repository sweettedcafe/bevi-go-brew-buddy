import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logo from "@/assets/bevi-logo.jpg";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

type Step = "email" | "code" | "password" | "done";

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (!email) return;
    setBusy(true);
    try {
      // shouldCreateUser: false — only send OTP to existing accounts
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      toast.success("Verification code sent. Check your email.");
      setStep("code");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e?: FormEvent) {
    e?.preventDefault();
    if (!code) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
      setStep("password");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid or expired code");
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword(e?: FormEvent) {
    e?.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Password updated. Please sign in with your new password.");
      setStep("done");
      setTimeout(() => navigate({ to: "/login" }), 1200);
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
            Forgot your <span className="italic text-primary">password</span>?
          </h2>
          <p className="mt-4 text-sm text-sidebar-foreground/70 max-w-md">
            We'll email you a 6-digit verification code so you can set a new one.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© Bevi &amp; Go</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <img src={logo} alt="Bevi & Go" className="h-9 w-auto mx-auto mb-8 lg:hidden" />
          <h1 className="text-3xl font-display mb-1">Reset password</h1>
          <p className="text-sm text-muted-foreground mb-8">
            {step === "email" && "Enter your account email to receive a code."}
            {step === "code" && `We sent a 6-digit code to ${email}.`}
            {step === "password" && "Choose a new password for your account."}
            {step === "done" && "All set — redirecting…"}
          </p>

          {step === "email" && (
            <form onSubmit={sendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Sending…" : "Send verification code"}
              </Button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input id="code" required inputMode="numeric" autoComplete="one-time-code"
                  value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="123456" className="tracking-widest text-center font-mono text-lg" />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Verifying…" : "Verify code"}
              </Button>
              <button type="button" onClick={() => sendCode()} disabled={busy}
                className="w-full text-xs text-muted-foreground hover:text-foreground">
                Resend code
              </button>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={setNewPassword} className="space-y-4">
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
          )}

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
