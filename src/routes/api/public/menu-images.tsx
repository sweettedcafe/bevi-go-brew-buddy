import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/menu-images")({
  server: {
    handlers: {
      GET: async () => {
        const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://ewwtxzoruibaxalffyli.supabase.co";
        const SERVICE_ROLE = process.env.APP_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!SUPABASE_URL || !SERVICE_ROLE) return json({ images: [] }, 200);

        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/menu_items?select=id,image_url&is_active=eq.true&image_url=not.is.null`,
          { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
        );

        if (!res.ok) return json({ images: [] }, 200);

        const rows = await res.json() as Array<{ id: string; image_url: string | null }>;
        return json({ images: rows }, 200);
      },
    },
  },
});

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}