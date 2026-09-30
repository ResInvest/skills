/** Szablony wiadomości (PL) z marką ResInvest ERP. Tekst + HTML (proste, czytelne w każdym kliencie poczty). */
export type MailTemplate = "invite" | "password-reset" | "password-changed" | "account-disabled" | "self-registration";
export interface RenderedMail { subject: string; text: string; html: string }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const FOOT = "Wiadomość wysłana automatycznie przez ResInvest ERP (ResInvest Commodities). Nie odpowiadaj na nią.";

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }): RenderedMail & { subject: string } {
  const text = [title, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : []), "", "—", FOOT].join("\n");
  const html = `<!doctype html><html lang="pl"><body style="margin:0;background:#f4f6f5;font-family:Segoe UI,Arial,sans-serif;color:#16211c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #d9e1dc;border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:3px solid #1f6b47"><strong style="font-size:18px;color:#1f6b47">ResInvest ERP</strong></td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${paragraphs.map(p => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join("")}
${action ? `<p style="margin:20px 0"><a href="${esc(action.url)}" style="background:#1f6b47;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${esc(action.label)}</a></p><p style="font-size:12px;color:#5b6b63;word-break:break-all">${esc(action.url)}</p>` : ""}
</td></tr><tr><td style="padding:16px 24px;font-size:12px;color:#5b6b63;border-top:1px solid #d9e1dc">${esc(FOOT)}</td></tr></table></td></tr></table></body></html>`;
  return { subject: title, text, html };
}

export function renderMail(t: MailTemplate, d: Record<string, string>): RenderedMail {
  switch (t) {
    case "invite": return { ...layout("Zaproszenie do ResInvest ERP", [`Dzień dobry ${d.name ?? ""},`, `${d.invitedBy ?? "Administrator"} zaprasza Cię do systemu ResInvest ERP (rola: ${d.role ?? ""}).`, `Kliknij przycisk, aby ustawić hasło i aktywować konto. Link jest ważny ${d.hours ?? "72"} godz. i można go użyć tylko raz.`], { label: "Aktywuj konto", url: d.url ?? "" }) };
    case "password-reset": return layout("Reset hasła — ResInvest ERP", ["Otrzymaliśmy prośbę o zmianę hasła do Twojego konta.", `Link jest ważny ${d.minutes ?? "60"} minut i można go użyć tylko raz. Jeśli to nie Ty — zignoruj tę wiadomość; hasło pozostanie bez zmian.`], { label: "Ustaw nowe hasło", url: d.url ?? "" });
    case "password-changed": return layout("Hasło zostało zmienione", [`Hasło do konta ${d.email ?? ""} zostało zmienione ${d.when ?? ""}.`, "Jeśli to nie Ty — natychmiast skontaktuj się z administratorem systemu."]);
    case "account-disabled": return layout("Konto zostało wyłączone", [`Konto ${d.email ?? ""} w ResInvest ERP zostało ${d.status ?? "wyłączone"}.`, "W razie pytań skontaktuj się z administratorem systemu."]);
    case "self-registration": return layout("Nowe zgłoszenie konta", [`Zgłoszenie konta: ${d.name ?? ""} (${d.email ?? ""}).`, "Nadaj rolę i magazyny w module Użytkownicy albo odrzuć zgłoszenie."], d.url ? { label: "Otwórz Użytkowników", url: d.url } : undefined);
  }
}
