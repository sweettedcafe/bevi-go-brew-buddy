import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/dev-set-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!token) return json({ error: "missing_bearer" }, 401);

        let body: any;
        try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }

        const targetUserId = String(body?.user_id ?? "").trim();
        const newPassword = String(body?.new_password ?? "");
        if (!targetUserId) return json({ error: "missing_user_id" }, 400);
        if (newPassword.length < 6) return json({ error: "password_too_short" }, 400);

        const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SERVICE_ROLE) {
          return json({ error: "server_not_configured" }, 500);
        }

        // Verify caller identity via their access token.
        const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${token}` },
        });
        if (!meRes.ok) return json({ error: "invalid_session" }, 401);
        const me = await meRes.json();
        const callerId = me?.id;
        if (!callerId) return json({ error: "invalid_session" }, 401);

        // Check caller is a developer or admin via service role read of user_roles.
        const roleRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${callerId}&select=role`,
          { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
        );
        if (!roleRes.ok) return json({ error: "role_check_failed" }, 500);
        const roles = (await roleRes.json()) as Array<{ role: string }>;
        const roleSet = new Set(roles.map((r) => r.role));
        if (!roleSet.has("developer") && !roleSet.has("admin")) {
          return json({ error: "forbidden" }, 403);
        }

        // Update the target user's password using admin API.
        const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetUserId}`, {
          method: "PUT",
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: `Bearer ${SERVICE_ROLE}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: newPassword }),
        });
        if (!upd.ok) {
          const errBody = await upd.text();
          console.error(`[dev-set-password] admin update failed [${upd.status}]: ${errBody}`);
          return json({ error: "update_failed", detail: errBody }, upd.status);
        }
        return json({ ok: true }, 200);
      },
    },
  },
});

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
