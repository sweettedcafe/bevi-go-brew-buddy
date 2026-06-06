import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type AppRole } from "@/integrations/supabase/client";

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  roleError: string | null;
  primaryRole: AppRole | null;
  hasRole: (role: AppRole) => boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const ROLE_PRIORITY: AppRole[] = ["developer", "admin", "barista"];

async function fetchRoles(userId: string): Promise<{ roles: AppRole[]; error: string | null }> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) {
    console.warn("[auth] failed to load roles", error.message);
    return { roles: [], error: error.message };
  }
  return { roles: (data ?? []).map((r) => r.role as AppRole), error: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [roleError, setRoleError] = useState<string | null>(null);

  const applySession = async (s: Session | null) => {
    setSession(s);
    setUser(s?.user ?? null);
    if (s?.user) {
      const result = await fetchRoles(s.user.id);
      setRoles(result.roles);
      setRoleError(result.error);
    } else {
      setRoles([]);
      setRoleError(null);
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer DB calls per Supabase recommendation
      setTimeout(() => {
        void applySession(s);
      }, 0);
    });

    supabase.auth.getSession().then(({ data }) => {
      void applySession(data.session).finally(() => setLoading(false));
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || roles.length > 0) return;

    const refresh = () => {
      void fetchRoles(user.id).then((result) => {
        setRoles(result.roles);
        setRoleError(result.error);
      });
    };

    const interval = window.setInterval(refresh, 4000);
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, roles.length]);

  const primaryRole =
    ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;

  const value: AuthState = {
    loading,
    session,
    user,
    roles,
    roleError,
    primaryRole,
    hasRole: (role) => roles.includes(role),
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refreshRoles: async () => {
      if (user) {
        const result = await fetchRoles(user.id);
        setRoles(result.roles);
        setRoleError(result.error);
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
