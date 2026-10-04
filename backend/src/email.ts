import { config } from './config.js'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function loginHtml({ name, code, link, isNew }: { name: string; code: string; link: string; isNew: boolean }) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F1F7F3;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0E1F18">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#FFFFFF;border-radius:24px;overflow:hidden">
  <tr><td style="background:#0A7A55;padding:28px 28px 24px;color:#FFFFFF">
    <div style="font-size:22px;font-weight:700;letter-spacing:-0.5px">tramo</div>
    <div style="margin-top:18px;font-size:15px;color:#C9F2E0">· · · · · · · · · · · · · · ●</div>
  </td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2">${isNew ? `¡Hola ${esc(name)}! Arranquemos` : `¡Hola de nuevo, ${esc(name)}!`}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#3F4B45">Tocá el botón para entrar a tramo y seguir con tu viaje.</p>
    <a href="${link}" style="display:inline-block;background:#0A7A55;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 26px;border-radius:28px">Entrar a tramo</a>
    <p style="margin:28px 0 8px;font-size:14px;color:#3F4B45">¿Usás la app instalada en el teléfono? Escribí este código:</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:10px;background:#F1F7F3;border-radius:14px;padding:14px 18px;text-align:center">${code}</div>
    <p style="margin:24px 0 0;font-size:12px;color:#94A39C">El link y el código vencen en 15 minutos. Si no pediste entrar, ignorá este email.</p>
  </td></tr>
</table></td></tr></table></body></html>`
}

/** Without a Resend key (local dev) the code and link go to the console instead. */
export async function sendLoginEmail(p: { to: string; name: string; code: string; link: string; isNew: boolean }) {
  if (!config.resendApiKey) {
    console.log(`[auth] código para ${p.to}: ${p.code} · link: ${p.link}`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.resendFrom,
      to: [p.to],
      subject: `${p.code} es tu código para entrar a tramo`,
      html: loginHtml(p),
      text: `Entrá a tramo: ${p.link}\n\nO escribí este código: ${p.code}\n\nVence en 15 minutos.`,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    console.error('[email] Resend', res.status, await res.text())
    throw new Error('No pudimos mandar el email. Probá de nuevo.')
  }
}
