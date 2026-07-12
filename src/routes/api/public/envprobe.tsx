import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/_env-probe")({
  server: {
    handlers: {
      GET: async () => {
        const keys = [
          "SUPABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_ANON_KEY",
          "VITE_SUPABASE_URL",
          "LOVABLE_API_KEY",
        ];
        const out: Record<string, string> = {};
        for (const k of keys) {
          const v = (process.env as any)[k];
          out[k] = v ? `set(len=${v.length})` : "MISSING";
        }
        return new Response(JSON.stringify(out, null, 2), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
