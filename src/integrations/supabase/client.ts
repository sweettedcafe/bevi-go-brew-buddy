import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://pwixzaejussrgxanxeyf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__iRNnva4zkjLSTcJuHH62A_MV2XZvCl";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type AppRole = "developer" | "admin" | "barista";
