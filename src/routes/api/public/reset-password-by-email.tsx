import { createFileRoute } from "@tanstack/react-router";

const SUPABASE_URL_FALLBACK = "https://ewwtxzoruibaxalffyli.supabase.co";

export const Route = createFileRoute("/api/public/reset-password-by-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { email, new_password } = (await request.json().catch(() => ({}))) as {
            email?: string;
            new_password?: string;
          };
          if (!email || !new_password || new_password.length < 6) {
            return json({ error: "invalid_input" }, 400);
          }

          const SUPABASE_URL =
            process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || SUPABASE_URL_FALLBACK;
          const SERVICE_ROLE = (process.env.APP_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
          if (!SERVICE_ROLE) return json({ error: "server_not_configured" }, 500);

          // Look up user by email via admin list (filter by email).
          const listRes = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
            { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
          );
          if (!listRes.ok) {
            const detail = await listRes.text();
            return json({ error: "lookup_failed", detail }, listRes.status);
          }
          const data: any = await listRes.json();
          const users = Array.isArray(data?.users) ? data.users : [];
          const match = users.find(
            (u: any) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
          );
          if (!match) return json({ error: "user_not_found" }, 404);

          const updRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${match.id}`, {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              apikey: SERVICE_ROLE,
              Authorization: `Bearer ${SERVICE_ROLE}`,
            },
            body: JSON.stringify({ password: new_password }),
          });
          if (!updRes.ok) {
            const detail = await updRes.text();
            return json({ error: "update_failed", detail }, updRes.status);
          }
          return json({ ok: true }, 200);
        } catch (e: any) {
          return json({ error: "server_error", detail: e?.message ?? String(e) }, 500);
        }
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
