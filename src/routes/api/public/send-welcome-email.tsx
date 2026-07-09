import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/send-welcome-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try { body = await request.json(); }
        catch { return json({ error: "invalid_json" }, 400); }

        const name = String(body?.name ?? "").trim();
        const email = String(body?.email ?? "").trim();
        const code = String(body?.code ?? "").trim();
        const orderUrl = String(body?.order_url ?? "").trim();

        if (!name || !email || !code || !orderUrl) {
          return json({ error: "missing_fields" }, 400);
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: "invalid_email" }, 400);
        }
        if (!/^https?:\/\//.test(orderUrl) || !orderUrl.includes("/o/")) {
          return json({ error: "invalid_url" }, 400);
        }

        const lovableKey = process.env.LOVABLE_API_KEY;
        const gmailKey = process.env.GOOGLE_MAIL_API_KEY;
        if (!lovableKey || !gmailKey) {
          console.warn("[welcome-email] Gmail connector not configured — skipping send");
          return json({ ok: false, reason: "email_not_configured" }, 200);
        }

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(orderUrl)}`;
        const qrCode = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(code)}`;
        const html = renderWelcomeHtml({ name, code, orderUrl, qrUrl, qrCode });
        const subject = "Welcome to Bevi & Go — your loyalty QR is inside \u2615";

        // Build RFC 2822 MIME message. Subject is encoded (RFC 2047) to allow non-ASCII.
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
            console.error(`[welcome-email] Gmail send failed [${res.status}]: ${errBody}`);
            return json({ ok: false, error: "provider_error", status: res.status }, 200);
          }
          return json({ ok: true }, 200);
        } catch (e: any) {
          console.error("[welcome-email] send error", e?.message);
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
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function chunk(s: string, size: number) {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.join("\r\n");
}

function renderWelcomeHtml(o: { name: string; code: string; orderUrl: string; qrUrl: string }) {
  const safeName = escapeHtml(o.name);
  const safeCode = escapeHtml(o.code);
  const safeUrl = escapeHtml(o.orderUrl);
  const safeQr = escapeHtml(o.qrUrl);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #eee;border-radius:12px;padding:32px;">
        <tr><td align="center" style="font-size:28px;font-weight:700;letter-spacing:-0.5px;color:#6b3f1d;">&#9749; Bevi &amp; Go</td></tr>
        <tr><td style="height:8px;"></td></tr>
        <tr><td style="font-size:20px;font-weight:600;">Welcome, ${safeName}! &#127881;</td></tr>
        <tr><td style="height:8px;"></td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#444;">
          Thanks for joining <strong>Bevi &amp; Go Rewards</strong>. Show the QR below at the counter — or open the link on your phone — to pre-order and earn loyalty points on every drink.
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        <tr><td align="center">
          <img src="${safeQr}" alt="Your Bevi &amp; Go QR code" width="240" height="240" style="border-radius:8px;border:1px solid #eee;padding:8px;background:#fff;" />
        </td></tr>
        <tr><td align="center" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;letter-spacing:2px;color:#6b3f1d;padding-top:12px;">
          ${safeCode}
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        <tr><td align="center">
          <a href="${safeUrl}" style="display:inline-block;background:#6b3f1d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Open my ordering page</a>
        </td></tr>
        <tr><td style="height:20px;"></td></tr>
        <tr><td style="font-size:12px;color:#888;line-height:1.6;">
          Keep this email — it's your rewards card. If you lose your QR, just ask a barista to look you up by phone or email.
        </td></tr>
        <tr><td style="height:16px;"></td></tr>
        <tr><td style="font-size:12px;color:#aaa;">— The Bevi &amp; Go team</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
