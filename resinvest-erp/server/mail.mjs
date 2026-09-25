/* =========================================================================
   ResInvest ERP Serwer — poczta: szablony (PL) i wysyłka.

   Transport (EMAIL_TRANSPORT):
     resend — API HTTPS Resend (https://api.resend.com/emails), klucz RESEND_API_KEY,
     smtp   — SMTP z TLS (domyślnie smtp.resend.com:465, użytkownik „resend”, hasło = klucz API),
     file   — zapis wiadomości .eml do katalogu danych (instalacja bez poczty, testy).
   Brak konfiguracji → „file” (wiadomości trafiają do <dataDir>/mail-outbox; administrator
   może przekazać link ręcznie). Klucze są czytane WYŁĄCZNIE po stronie serwera
   (zmienne środowiskowe lub plik server.env) i nigdy nie trafiają do przeglądarki.
   ========================================================================= */
import { connect as tlsConnect } from "node:tls";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- szablony ---------------- */
const BRAND = { name: "ResInvest ERP", green: "#1E6B45", ink: "#1F2A33", muted: "#5B6B78", line: "#DDE3E8", bg: "#F4F6F8" };

function layout({ title, lead, lines = [], button, link, note }) {
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Segoe UI,Arial,sans-serif;color:${BRAND.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.line};border-radius:10px;overflow:hidden">
<tr><td style="background:${BRAND.green};padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px">${BRAND.name}<div style="font-size:12px;font-weight:400;opacity:.85">ResInvest Commodities · system magazynowy</div></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;color:${BRAND.ink}">${esc(title)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(lead)}</p>
${lines.map(l => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${BRAND.muted}">${esc(l)}</p>`).join("")}
${button && link ? `<p style="margin:20px 0"><a href="${esc(link)}" style="display:inline-block;background:${BRAND.green};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px">${esc(button)}</a></p>
<p style="margin:0 0 8px;font-size:12px;color:${BRAND.muted}">Jeśli przycisk nie działa, skopiuj adres do przeglądarki:<br><span style="word-break:break-all">${esc(link)}</span></p>` : ""}
${note ? `<p style="margin:16px 0 0;font-size:12px;color:${BRAND.muted}">${esc(note)}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid ${BRAND.line};font-size:11px;color:${BRAND.muted}">Wiadomość wysłana automatycznie przez ${BRAND.name}. Nie odpowiadaj na nią. Jeśli nie spodziewałeś się tej wiadomości, skontaktuj się z administratorem systemu.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [BRAND.name, "", title, "", lead, ...lines, ...(link ? ["", `${button}: ${link}`] : []), ...(note ? ["", note] : []), "",
    `Wiadomość wysłana automatycznie przez ${BRAND.name}. Nie odpowiadaj na nią.`].join("\n");
  return { html, text };
}

/** Szablony wiadomości (język polski). `d` — dane: name, link, hours, email, oldEmail, newEmail, by. */
export const TEMPLATES = {
  invite: d => Object.assign({ subject: "Zaproszenie do ResInvest ERP" }, layout({
    title: "Zaproszenie do ResInvest ERP", lead: `Dzień dobry ${d.name}, administrator założył dla Ciebie konto w systemie ResInvest ERP.`,
    lines: [`Login: ${d.email}`, d.role ? `Rola: ${d.role}` : "", d.warehouse ? `Magazyn: ${d.warehouse}` : ""].filter(Boolean),
    button: "Ustaw hasło i aktywuj konto", link: d.link, note: `Link jest ważny ${d.hours} godz. i można go użyć tylko raz.` })),
  confirm: d => Object.assign({ subject: "Potwierdź adres e-mail — ResInvest ERP" }, layout({
    title: "Potwierdzenie adresu e-mail", lead: `Dzień dobry ${d.name}, potwierdź, że adres ${d.email} należy do Ciebie.`,
    button: "Potwierdź adres e-mail", link: d.link, note: `Link jest ważny ${d.hours} godz. Do czasu potwierdzenia logowanie na nowy adres jest zablokowane.` })),
  reset: d => Object.assign({ subject: "Reset hasła — ResInvest ERP" }, layout({
    title: "Reset hasła", lead: `Dzień dobry ${d.name}, otrzymaliśmy prośbę o ustawienie nowego hasła do konta ${d.email}.`,
    button: "Ustaw nowe hasło", link: d.link, note: `Link jest ważny ${d.hours} godz. i można go użyć tylko raz. Jeśli to nie Ty — zignoruj wiadomość; obecne hasło pozostaje bez zmian.` })),
  emailChanged: d => Object.assign({ subject: "Zmiana adresu e-mail konta — ResInvest ERP" }, layout({
    title: "Zmiana adresu e-mail", lead: `Adres e-mail Twojego konta w ResInvest ERP został zmieniony z ${d.oldEmail} na ${d.newEmail}.`,
    lines: [d.by ? `Zmiany dokonał: ${d.by}` : ""].filter(Boolean), note: "Jeśli to nie Ty zleciłeś zmianę, niezwłocznie skontaktuj się z administratorem." })),
  passwordChanged: d => Object.assign({ subject: "Hasło zostało zmienione — ResInvest ERP" }, layout({
    title: "Hasło zostało zmienione", lead: `Dzień dobry ${d.name}, hasło do konta ${d.email} zostało zmienione.`,
    note: "Jeśli to nie Ty zmieniłeś hasło, niezwłocznie skontaktuj się z administratorem." })),
  deactivated: d => Object.assign({ subject: "Konto dezaktywowane — ResInvest ERP" }, layout({
    title: "Konto dezaktywowane", lead: `Dzień dobry ${d.name}, Twoje konto ${d.email} w ResInvest ERP zostało dezaktywowane.`,
    lines: ["Historia Twoich operacji pozostaje w systemie."], note: "W razie pytań skontaktuj się z administratorem." }))
};

/* ---------------- konfiguracja ---------------- */
export function mailConfig(env, dataDir) {
  const key = String(env.RESEND_API_KEY || "").trim();
  let transport = String(env.EMAIL_TRANSPORT || "").trim().toLowerCase();
  if (!transport) transport = key ? "resend" : "file";
  if (!["resend", "smtp", "file"].includes(transport)) transport = "file";
  return {
    transport, key,
    from: String(env.EMAIL_FROM || "ResInvest ERP <no-reply@resinvest.group>").trim(),
    replyTo: String(env.EMAIL_REPLY_TO || "").trim(),
    smtp: { host: String(env.SMTP_HOST || "smtp.resend.com"), port: Number(env.SMTP_PORT || 465), user: String(env.SMTP_USER || "resend"), pass: String(env.SMTP_PASS || key) },
    outDir: join(dataDir, "mail-outbox"),
    apiUrl: String(env.RESEND_API_URL || "https://api.resend.com/emails")
  };
}
/** Opis konfiguracji bez sekretów (panel administratora, raport startowy). */
export const mailInfo = c => ({ transport: c.transport, from: c.from, configured: c.transport === "file" || !!c.key || (c.transport === "smtp" && !!c.smtp.pass), outDir: c.transport === "file" ? c.outDir : "" });

/* ---------------- wysyłka ---------------- */
const b64 = s => Buffer.from(String(s), "utf8").toString("base64");
const encHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const addr = s => { const m = /<([^>]+)>/.exec(s); return (m ? m[1] : s).trim(); };
const encFrom = s => { const m = /^(.*)<([^>]+)>\s*$/.exec(s); return m ? `${encHeader(m[1].trim())} <${m[2]}>` : s; };
function mime(c, msg) {
  const boundary = "riw" + randomBytes(12).toString("hex"), id = `<${randomBytes(16).toString("hex")}@resinvest-erp>`;
  const wrap = s => b64(s).replace(/.{1,76}/g, "$&\r\n");
  return { id, data: [
    `From: ${encFrom(c.from)}`, `To: ${msg.to}`, `Subject: ${encHeader(msg.subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${id}`,
    ...(c.replyTo ? [`Reply-To: ${c.replyTo}`] : []), "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(msg.text),
    `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(msg.html),
    `--${boundary}--`, ""].join("\r\n") };
}
async function viaResend(c, msg) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(c.apiUrl, { method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ from: c.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }, c.replyTo ? { reply_to: c.replyTo } : {})) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${body.message || body.name || "błąd"}`);
    return { providerId: body.id || "" };
  } finally { clearTimeout(timer); }
}
function viaSmtp(c, msg) {
  return new Promise((resolve, reject) => {
    const { id, data } = mime(c, msg);
    const steps = [
      [null, 220], [`EHLO resinvest-erp`, 250], [`AUTH LOGIN`, 334], [b64(c.smtp.user), 334], [b64(c.smtp.pass), 235],
      [`MAIL FROM:<${addr(c.from)}>`, 250], [`RCPT TO:<${addr(msg.to)}>`, 250], [`DATA`, 354],
      [data.replace(/\r\n\./g, "\r\n..") + "\r\n.", 250], [`QUIT`, 221]
    ];
    let i = 0, buf = "", done = false;
    const sock = tlsConnect({ host: c.smtp.host, port: c.smtp.port, servername: c.smtp.host });
    const fail = e => { if (done) return; done = true; sock.destroy(); reject(e instanceof Error ? e : new Error(String(e))); };
    sock.setTimeout(20000, () => fail(new Error("SMTP: przekroczony czas")));
    sock.on("error", fail);
    sock.on("data", chunk => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\r\n"); buf = lines.pop();
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;              // odpowiedź wieloliniowa
        const code = Number(line.slice(0, 3));
        if (code !== steps[i][1]) return fail(new Error(`SMTP ${line.slice(0, 200)}`));
        i++;
        if (i >= steps.length) { done = true; sock.end(); return resolve({ providerId: id }); }
        sock.write(steps[i][0] + "\r\n");
      }
    });
  });
}
function viaFile(c, msg) {
  mkdirSync(c.outDir, { recursive: true });
  const { id, data } = mime(c, msg);
  const name = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${msg.template}-${randomBytes(4).toString("hex")}.eml`;
  writeFileSync(join(c.outDir, name), data);
  return { providerId: id, file: name };
}

/**
 * Wysyła wiadomość z szablonu. Nigdy nie rzuca — zwraca { ok, error?, providerId?, file? }.
 * Szczegóły błędu trafiają do dziennika serwera; użytkownik widzi komunikat ogólny.
 */
export async function sendMail(c, template, to, data, log) {
  const tpl = TEMPLATES[template];
  if (!tpl) return { ok: false, error: "unknown template" };
  const msg = Object.assign({ to, template }, tpl(data || {}));
  try {
    if (c.transport !== "file" && !(c.key || (c.transport === "smtp" && c.smtp.pass))) throw new Error("brak klucza RESEND_API_KEY / SMTP_PASS");
    const r = c.transport === "resend" ? await viaResend(c, msg) : c.transport === "smtp" ? await viaSmtp(c, msg) : viaFile(c, msg);
    if (log) log("INFO", `E-mail „${template}” → ${to} (${c.transport}${r.file ? ": " + r.file : ""})`);
    return Object.assign({ ok: true, subject: msg.subject }, r);
  } catch (e) {
    if (log) log("ERROR", `E-mail „${template}” → ${to} nieudany (${c.transport}): ${e.message}`);
    return { ok: false, error: e.message, subject: msg.subject };
  }
}
