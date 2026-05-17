import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/bevi-logo.jpg";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, primaryRole, loading } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <img src={logo} alt="Bevi & Go" className="h-10 w-auto" />
        <nav className="flex items-center gap-3">
          {!loading && user ? (
            <Button asChild>
              <Link to="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          )}
        </nav>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-6">
            Coffee Shop Enterprise Platform
          </p>
          <h1 className="text-5xl md:text-6xl font-display text-foreground leading-tight">
            Pour, scan, sell —<br />
            <span className="text-primary italic">all from one counter.</span>
          </h1>
          <p className="mt-6 text-muted-foreground text-lg leading-relaxed">
            Bevi &amp; Go pairs a fast barista POS with inventory recipes, loyalty,
            and shift-aware reporting. Built for the rush, designed for the regulars.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            {!loading && user ? (
              <Button asChild size="lg">
                <Link to="/dashboard">
                  Continue as {primaryRole ?? "user"}
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link to="/login">Sign in to continue</Link>
              </Button>
            )}
          </div>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Bevi &amp; Go — Phase 1: Foundation
      </footer>
    </div>
  );
}
