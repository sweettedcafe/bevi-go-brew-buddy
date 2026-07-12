import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/send-password-otp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }

        const email = String(body?.email ?? "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: "invalid_email" }, 400);
        }

        const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://ewwtxzoruibaxalffyli.supabase.co";
        const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SERVICE_ROLE) {
          return json({ error: "server_not_configured" }, 500);
        }

        // Ask Supabase to generate a recovery OTP; we email it ourselves so the
        // customer receives a 6-digit code instead of a magic link.
        const gen = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
          method: "POST",
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: `Bearer ${SERVICE_ROLE}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "recovery", email }),
        });
        if (!gen.ok) {
          const detail = await gen.text();
          console.error(`[send-password-otp] generate_link failed [${gen.status}]: ${detail}`);
          // Do not leak whether the email exists — respond ok.
          return json({ ok: true }, 200);
        }
        const linkData: any = await gen.json();
        const otp: string =
          linkData?.properties?.email_otp ??
          linkData?.email_otp ??
          "";
        if (!otp) {
          console.error("[send-password-otp] no email_otp in response");
          return json({ ok: true }, 200);
        }

        const lovableKey = process.env.LOVABLE_API_KEY;
        const gmailKey = process.env.GOOGLE_MAIL_API_KEY;
        if (!lovableKey || !gmailKey) {
          console.warn("[send-password-otp] Gmail connector not configured");
          return json({ ok: false, reason: "email_not_configured" }, 200);
        }

        const subject = "Your Bevi & Go password reset code";
        const html = renderOtpHtml(otp);
        const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
        const mime = [
          `To: ${email}`,
          `Subject: ${encodedSubject}`,
          "MIME-Version: 1.0",
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          chunk(btoa(unescape(encodeURIComponent(html))), 76),
        ].join("\r\n");
        const raw = base64url(mime);

        try {
          const res = await fetch(
            "https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${lovableKey}`,
                "X-Connection-Api-Key": gmailKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ raw }),
            },
          );
          if (!res.ok) {
            const errBody = await res.text();
            console.error(`[send-password-otp] Gmail send failed [${res.status}]: ${errBody}`);
            return json({ ok: false, error: "provider_error" }, 200);
          }
          return json({ ok: true }, 200);
        } catch (e: any) {
          console.error("[send-password-otp] send error", e?.message);
          return json({ ok: false, error: "send_failed" }, 200);
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
function base64url(s: string) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function chunk(s: string, size: number) {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.join("\r\n");
}
function renderOtpHtml(code: string) {
  const safeCode = code.replace(/[^0-9]/g, "");
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #eee;border-radius:12px;padding:32px;">
        <tr><td align="center" style="font-size:24px;font-weight:700;color:#6b3f1d;">&#9749; Bevi &amp; Go</td></tr>
        <tr><td style="height:16px;"></td></tr>
        <tr><td style="font-size:16px;font-weight:600;">Password reset code</td></tr>
        <tr><td style="height:12px;"></td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#444;">
          Use the verification code below to reset your password. It expires in about an hour.
        </td></tr>
        <tr><td style="height:20px;"></td></tr>
        <tr><td align="center" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#6b3f1d;background:#faf6f2;border:1px solid #eee;border-radius:8px;padding:16px;">
          ${safeCode}
        </td></tr>
        <tr><td style="height:20px;"></td></tr>
        <tr><td style="font-size:12px;color:#888;line-height:1.6;">
          If you didn't request this, you can safely ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
