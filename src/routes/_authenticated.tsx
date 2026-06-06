import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import logo from "@/assets/bevi-logo.jpg";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard, ShoppingCart, Package, BookOpen, Users, Tag,
  CreditCard, BarChart3, Clock, ShieldCheck, LogOut, Receipt, Printer, Menu,
  ClipboardList, FileText, ChevronDown, ChevronRight, Coffee, Wallet, Settings, Gift, History,
} from "lucide-react";
import type { AppRole } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; roles: AppRole[] };
type NavGroup = { id: string; label: string; icon: typeof LayoutDashboard; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    id: "overview", label: "Overview", icon: LayoutDashboard, items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["developer", "admin"] },
    ],
  },
  {
    id: "sales", label: "Sales", icon: Coffee, items: [
      { to: "/pos", label: "POS", icon: ShoppingCart, roles: ["developer", "admin", "barista"] },
      { to: "/history", label: "Today's Orders", icon: Receipt, roles: ["developer", "admin"] },
      { to: "/end-of-shift", label: "End of Shift", icon: ClipboardList, roles: ["developer", "admin", "barista"] },
      { to: "/eos-admin", label: "EOS by Date", icon: ClipboardList, roles: ["developer", "admin"] },
    ],
  },
  {
    id: "catalog", label: "Catalog", icon: BookOpen, items: [
      { to: "/menu", label: "Menu & Recipes", icon: BookOpen, roles: ["developer", "admin"] },
      { to: "/bundles", label: "Bundles", icon: Gift, roles: ["developer", "admin"] },
      { to: "/inventory", label: "Inventory", icon: Package, roles: ["developer", "admin"] },
    ],
  },
  {
    id: "customers", label: "Customers", icon: Users, items: [
      { to: "/customers", label: "Customers", icon: Users, roles: ["developer", "admin"] },
      { to: "/discounts", label: "Discounts", icon: Tag, roles: ["developer", "admin"] },
    ],
  },
  {
    id: "payroll", label: "Payroll", icon: Wallet, items: [
      { to: "/timeclock", label: "Timeclock", icon: Clock, roles: ["developer", "admin", "barista"] },
      { to: "/timeclock-report", label: "Timeclock Report", icon: Clock, roles: ["developer", "admin"] },
      { to: "/payslip", label: "Payslip", icon: Receipt, roles: ["developer", "admin"] },
    ],
  },
  {
    id: "reports", label: "Reports", icon: BarChart3, items: [
      { to: "/reports", label: "Reports", icon: BarChart3, roles: ["developer", "admin"] },
      { to: "/sales-summary", label: "Sales Summary", icon: FileText, roles: ["developer", "admin"] },
    ],
  },
  {
    id: "settings", label: "Settings", icon: Settings, items: [
      { to: "/payments", label: "Payment Methods", icon: CreditCard, roles: ["developer", "admin"] },
      { to: "/print-settings", label: "Print Settings", icon: Printer, roles: ["developer", "admin"] },
      { to: "/staff", label: "Staff & Roles", icon: ShieldCheck, roles: ["developer", "admin"] },
      { to: "/audit-log", label: "Audit Log", icon: History, roles: ["developer", "admin"] },
    ],
  },
];

function AuthenticatedLayout() {
  const { loading, user, primaryRole, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center space-y-4">
          <img src={logo} alt="Bevi & Go" className="h-12 w-auto mx-auto" />
          <h1 className="text-2xl font-display">Sign in required</h1>
          <p className="text-sm text-muted-foreground">This area is for Bevi &amp; Go staff only.</p>
          <Button onClick={() => navigate({ to: "/login" })} className="w-full">Go to sign-in</Button>
        </div>
      </div>
    );
  }

  const role: AppRole = primaryRole ?? "barista";
  const visibleGroups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) }))
    .filter((g) => g.items.length > 0);

  // Auto-open the group containing the active route
  const activeGroupId = visibleGroups.find((g) => g.items.some((i) => i.to === path))?.id;

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-sidebar text-sidebar-foreground flex-col">
        <div className="p-5 border-b border-sidebar-border">
          <img src={logo} alt="Bevi & Go" className="h-9 w-auto bg-background rounded-md p-1" />
        </div>
        <GroupedNav groups={visibleGroups} activeGroupId={activeGroupId} path={path} />
        <Footer
          user={user}
          primaryRole={primaryRole}
          rolesCount={roles.length}
          onSignOut={async () => { await signOut(); navigate({ to: "/login" }); }}
        />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b bg-card">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 bg-sidebar text-sidebar-foreground border-sidebar-border">
              <div className="flex flex-col h-full">
                <div className="p-5 border-b border-sidebar-border">
                  <img src={logo} alt="Bevi & Go" className="h-9 w-auto bg-background rounded-md p-1" />
                </div>
                <GroupedNav
                  groups={visibleGroups}
                  activeGroupId={activeGroupId}
                  path={path}
                  onNavigate={() => setMobileOpen(false)}
                />
                <Footer
                  user={user}
                  primaryRole={primaryRole}
                  rolesCount={roles.length}
                  onSignOut={async () => { await signOut(); navigate({ to: "/login" }); }}
                />
              </div>
            </SheetContent>
          </Sheet>
          <img src={logo} alt="Bevi & Go" className="h-7 w-auto" />
          <span className="font-display text-lg">Bevi &amp; Go</span>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function GroupedNav({
  groups, activeGroupId, path, onNavigate,
}: {
  groups: NavGroup[];
  activeGroupId: string | undefined;
  path: string;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) init[g.id] = g.id === activeGroupId || g.items.length === 1;
    return init;
  });
  function toggle(id: string) {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  }
  return (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {groups.map((g) => {
        const GIcon = g.icon;
        const isOpen = open[g.id] ?? false;
        const hasActive = g.items.some((i) => i.to === path);
        // Single-item groups render as a flat link
        if (g.items.length === 1) {
          const it = g.items[0];
          const Icon = it.icon;
          const active = path === it.to;
          return (
            <Link
              key={it.to}
              to={it.to}
              onClick={onNavigate}
              className={[
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {it.label}
            </Link>
          );
        }
        return (
          <div key={g.id}>
            <button
              type="button"
              onClick={() => toggle(g.id)}
              className={[
                "w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs uppercase tracking-wide transition-colors",
                hasActive
                  ? "text-sidebar-foreground"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground",
              ].join(" ")}
            >
              <GIcon className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{g.label}</span>
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            {isOpen && (
              <div className="mt-0.5 ml-2 pl-2 border-l border-sidebar-border space-y-0.5">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const active = path === item.to;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onNavigate}
                      className={[
                        "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      ].join(" ")}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Footer({
  user, primaryRole, rolesCount, onSignOut,
}: {
  user: { email?: string | null };
  primaryRole: AppRole | null;
  rolesCount: number;
  onSignOut: () => void | Promise<void>;
}) {
  return (
    <div className="p-3 border-t border-sidebar-border">
      <div className="px-3 py-2 text-xs text-sidebar-foreground/60">
        <div className="font-medium text-sidebar-foreground truncate">{user.email}</div>
        <div className="mt-0.5 capitalize">
          {primaryRole ? primaryRole : "No role assigned"}
          {rolesCount > 1 ? ` +${rolesCount - 1}` : ""}
        </div>
      </div>
      <Button
        variant="ghost"
        className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        onClick={onSignOut}
      >
        <LogOut className="h-4 w-4 mr-2" />
        Sign out
      </Button>
    </div>
  );
}
