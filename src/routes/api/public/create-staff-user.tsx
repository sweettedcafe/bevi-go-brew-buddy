import { createFileRoute } from "@tanstack/react-router";

const ALLOWED = new Set(["barista", "accountant", "partner", "admin", "developer"]);

export const Route = createFileRoute("/api/public/create-staff-user")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (!token) return json({ error: "missing_bearer" }, 401);

        let body: any;
        try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
        const email = String(body?.email ?? "").trim().toLowerCase();
        const password = String(body?.password ?? "");
        const role = String(body?.role ?? "barista");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" }, 400);
        if (password.length < 6) return json({ error: "password_too_short" }, 400);
        if (!ALLOWED.has(role)) return json({ error: "invalid_role" }, 400);

        const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://ewwtxzoruibaxalffyli.supabase.co";
        const SR = process.env.APP_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SR) return json({ error: "server_not_configured" }, 500);
        const admin = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

        const meRes = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SR, Authorization: `Bearer ${token}` } });
        if (!meRes.ok) return json({ error: "invalid_session" }, 401);
        const me = await meRes.json();
        if (!me?.id) return json({ error: "invalid_session" }, 401);

        const roleRes = await fetch(`${URL_}/rest/v1/user_roles?user_id=eq.${me.id}&select=role`, { headers: admin });
        if (!roleRes.ok) return json({ error: "role_check_failed" }, 500);
        const mine = new Set(((await roleRes.json()) as Array<{ role: string }>).map((r) => r.role));
        const isDev = mine.has("developer");
        if (!isDev && !mine.has("admin")) return json({ error: "forbidden" }, 403);
        if (role === "developer" && !isDev) return json({ error: "forbidden_role" }, 403);

        const created = await fetch(`${URL_}/auth/v1/admin/users`, {
          method: "POST", headers: admin,
          body: JSON.stringify({ email, password, email_confirm: true }),
        });
        const cBody = await created.json().catch(() => ({}));
        if (!created.ok) {
          const msg = String(cBody?.msg ?? cBody?.message ?? cBody?.error_description ?? "create_failed");
          return json({ error: msg }, created.status);
        }
        const newId = cBody?.id ?? cBody?.user?.id;
        const ins = await fetch(`${URL_}/rest/v1/user_roles`, {
          method: "POST", headers: { ...admin, Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify({ user_id: newId, role }),
        });
        if (!ins.ok) return json({ error: "role_assign_failed", detail: await ins.text() }, 500);
        return json({ ok: true, user_id: newId }, 200);
      },
    },
  },
});

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
