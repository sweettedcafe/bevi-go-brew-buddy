import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://ewwtxzoruibaxalffyli.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kOSj2qrRQ_S_a34In7uV0w_GBEufPWW";

// If a tablet sleeps, the login token can expire before the auto-refresh runs.
// When a data request comes back "JWT expired", refresh the session once and retry.
let refreshing: Promise<string | null> | null = null;
async function freshToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = supabase.auth.refreshSession()
      .then(({ data }) => data.session?.access_token ?? null)
      .catch(() => null)
      .finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  }
  return refreshing;
}

const retryingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (res.status !== 401 || url.includes("/auth/v1/")) return res;
  const body = await res.clone().text().catch(() => "");
  if (!/jwt expired|PGRST301|PGRST303|exp.*claim/i.test(body)) return res;
  const token = await freshToken();
  if (!token) return res;
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: { fetch: retryingFetch },
});

// Refresh right away when the screen wakes up / tab regains focus.
if (typeof window !== "undefined") {
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    void supabase.auth.getSession().then(({ data }) => {
      const exp = data.session?.expires_at ?? 0;
      if (data.session && exp * 1000 - Date.now() < 120_000) void freshToken();
    });
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
}

export type AppRole = "developer" | "admin" | "barista" | "accountant" | "partner";
