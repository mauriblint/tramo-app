// Cloudflare Email Worker for the booking-forwarding address (see docs/INBOUND_EMAIL.md).
// Email Routing hands every email sent to that address to this Worker, which posts the raw message
// to the backend. Variables (Worker → Settings → Variables): BACKEND_URL, INBOUND_SECRET (secret),
// and optionally FORWARD_TO, a verified Email Routing destination that also gets a copy (handy while testing).

export default {
  async email(message, env) {
    if (env.FORWARD_TO) await message.forward(env.FORWARD_TO)

    const raw = await new Response(message.raw).arrayBuffer()
    const res = await fetch(`${env.BACKEND_URL}/api/inbound/email`, {
      method: 'POST',
      headers: {
        'content-type': 'message/rfc822',
        'x-inbound-secret': env.INBOUND_SECRET,
        'x-envelope-from': message.from,
        'x-envelope-to': message.to,
      },
      body: raw,
    })
    // Only a backend failure bounces; unknown senders get a 202 and are dropped there.
    if (!res.ok) message.setReject(`tramo no pudo procesar el email (${res.status}). Probá de nuevo más tarde.`)
  },
}
