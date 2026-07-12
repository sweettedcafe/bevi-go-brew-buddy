import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/dev-list-users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!token) return json({ error: "missing_bearer" }, 401);

        const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "server_not_configured" }, 500);

        const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${token}` },
        });
        if (!meRes.ok) return json({ error: "invalid_session" }, 401);
        const me = await meRes.json();
        const callerId = me?.id;
        if (!callerId) return json({ error: "invalid_session" }, 401);

        // Allow developer or admin.
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

        // Page through admin users endpoint.
        const users: Array<{ id: string; email: string; name: string | null; roles: string[] }> = [];
        let page = 1;
        const perPage = 200;
        // Fetch all user_roles once for name/role mapping.
        const allRolesRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_roles?select=user_id,role`,
          { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
        );
        const allRoles = allRolesRes.ok ? ((await allRolesRes.json()) as Array<{ user_id: string; role: string }>) : [];
        const rolesByUser = new Map<string, string[]>();
        for (const r of allRoles) {
          const arr = rolesByUser.get(r.user_id) ?? [];
          arr.push(r.role);
          rolesByUser.set(r.user_id, arr);
        }
        const profilesRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?select=id,full_name`,
          { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
        );
        const profiles = profilesRes.ok ? ((await profilesRes.json()) as Array<{ id: string; full_name: string | null }>) : [];
        const nameById = new Map(profiles.map((p) => [p.id, p.full_name] as const));

        while (true) {
          const listRes = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
            { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
          );
          if (!listRes.ok) {
            const detail = await listRes.text();
            console.error(`[dev-list-users] admin list failed [${listRes.status}]: ${detail}`);
            return json({ error: "list_failed", detail }, listRes.status);
          }
          const data: any = await listRes.json();
          const batch = Array.isArray(data?.users) ? data.users : [];
          for (const u of batch) {
            users.push({
              id: u.id,
              email: u.email ?? "",
              name:
                nameById.get(u.id) ??
                (u.user_metadata?.full_name ?? u.user_metadata?.name ?? null),
              roles: rolesByUser.get(u.id) ?? [],
            });
          }
          if (batch.length < perPage) break;
          page += 1;
          if (page > 25) break; // safety cap 5000 users
        }
        users.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
        return json({ ok: true, users }, 200);
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
