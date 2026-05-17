import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type AppRole } from "@/integrations/supabase/client";

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  primaryRole: AppRole | null;
  hasRole: (role: AppRole) => boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const ROLE_PRIORITY: AppRole[] = ["developer", "admin", "barista"];

async function fetchRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) {
    console.warn("[auth] failed to load roles", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.role as AppRole);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);

  const applySession = async (s: Session | null) => {
    setSession(s);
    setUser(s?.user ?? null);
    if (s?.user) {
      const r = await fetchRoles(s.user.id);
      setRoles(r);
    } else {
      setRoles([]);
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

  const primaryRole =
    ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;

  const value: AuthState = {
    loading,
    session,
    user,
    roles,
    primaryRole,
    hasRole: (role) => roles.includes(role),
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refreshRoles: async () => {
      if (user) setRoles(await fetchRoles(user.id));
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
