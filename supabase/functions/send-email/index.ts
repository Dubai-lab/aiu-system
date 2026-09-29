// Supabase Edge Function: send-email
//
// Email relay for hosts that block outgoing SMTP (e.g. Railway Hobby). The backend
// renders the email as usual and POSTs it here over HTTPS; this function sends it
// through Gmail SMTP on port 465 (Supabase blocks outgoing ports 25 and 587 only).
//
// Security:
//   * Only callers that know RELAY_KEY (the backend) can send; compared in constant time.
//   * The sender is always SMTP_USER, so the relay can never be used to fake a sender.
//   * The request body is validated and size-limited; nothing is stored.
//
// Secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   SMTP_USER       Gmail address, e.g. eg8217178@gmail.com
//   SMTP_PASSWORD   Gmail app password (16 characters, no spaces)
//   RELAY_KEY       long random string; same value as EMAIL_RELAY_KEY in backend/.env
//   SMTP_HOST, SMTP_PORT (optional; default smtp.gmail.com and 465)

import nodemailer from "npm:nodemailer@6.9.16";

const MAX_BODY_CHARS = 500_000;
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Secrets are read on every request, so a secret changed in the dashboard applies at once.
 *  Surrounding spaces/newlines (easy to paste by accident) are ignored. */
function config() {
  const port = Number((Deno.env.get("SMTP_PORT") ?? "465").trim());
  return {
    host: (Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com").trim(),
    port,
    user: (Deno.env.get("SMTP_USER") ?? "").trim(),
    password: (Deno.env.get("SMTP_PASSWORD") ?? "").replace(/\s+/g, ""),
    relayKey: (Deno.env.get("RELAY_KEY") ?? "").trim(),
  };
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Constant-time string comparison, so the key cannot be guessed from response timing. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const cfg = config();
  if (!cfg.relayKey || !cfg.user || !cfg.password) {
    return json({ ok: false, error: "Relay is not configured (SMTP_USER, SMTP_PASSWORD, RELAY_KEY)" }, 500);
  }
  if (!sameSecret((req.headers.get("x-relay-key") ?? "").trim(), cfg.relayKey)) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON" }, 400);
  }
  const to = String(body.to ?? "").trim();
  const subject = String(body.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const html = String(body.html ?? "");
  const text = String(body.text ?? "");
  const fromName = String(body.from_name ?? "AIU Administration").replace(/[\r\n"<>]+/g, " ").trim().slice(0, 100);

  if (!EMAIL_RE.test(to)) return json({ ok: false, error: "Invalid recipient address" }, 400);
  if (!subject || subject.length > 300) return json({ ok: false, error: "Invalid subject" }, 400);
  if (!text && !html) return json({ ok: false, error: "Empty email" }, 400);
  if (html.length > MAX_BODY_CHARS || text.length > MAX_BODY_CHARS) return json({ ok: false, error: "Email too large" }, 413);

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465, // implicit TLS on 465
    auth: { user: cfg.user, pass: cfg.password },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
  try {
    const info = await transporter.sendMail({
      from: { name: fromName, address: cfg.user },
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
    });
    return json({ ok: true, id: info.messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("send-email failed:", message);
    return json({ ok: false, error: message.slice(0, 300) }, 502);
  }
});
