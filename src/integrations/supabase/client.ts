import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ewwtxzoruibaxalffyli.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kOSj2qrRQ_S_a34In7uV0w_GBEufPWW";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type AppRole = "developer" | "admin" | "barista";
