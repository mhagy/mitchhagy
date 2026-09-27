// Vercel serverless function: receives Resend "email.received" webhooks for
// advisory@mitchhagy.com and forwards each message to your personal inbox.
// Environment variables (Vercel project settings):
//   RESEND_API_KEY        - Resend API key with FULL access (needed to read received emails)
//   RESEND_WEBHOOK_SECRET - signing secret from the Resend webhook (starts with whsec_)
//   FORWARD_TO            - where to forward, e.g. mhagy@me.com

const crypto = require('crypto');

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', c => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verify(payload, headers, secret) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !ts || !sigHeader || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // 5-minute window
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64');
  return sigHeader.split(' ').some(part => {
    const sig = part.split(',')[1];
    return sig && sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

async function resend(path, opts = {}) {
  const r = await fetch(`https://api.resend.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Resend ${path} ${r.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const payload = await readRaw(req);
  if (!verify(payload, req.headers, process.env.RESEND_WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  let event;
  try { event = JSON.parse(payload); } catch { return res.status(400).send('Bad JSON'); }
  if (event.type !== 'email.received') return res.status(200).send('Ignored');

  try {
    const email = await resend(`/emails/receiving/${event.data.email_id}`);
    const from = email.from || event.data.from || 'unknown sender';
    const subject = email.subject || event.data.subject || '(no subject)';
    const header = `<p style="font:13px/1.4 -apple-system,Helvetica,Arial,sans-serif;color:#666;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:16px">
      Forwarded from <strong>advisory@mitchhagy.com</strong><br>From: ${String(from).replace(/</g, '&lt;')}</p>`;

    if (!process.env.FORWARD_TO) throw new Error('FORWARD_TO environment variable is not set');
    await resend('/emails', {
      method: 'POST',
      body: JSON.stringify({
        from: 'MGH Advisory <advisory@mitchhagy.com>',
        to: [process.env.FORWARD_TO],
        reply_to: from,
        subject: `Fwd: ${subject}`,
        html: header + (email.html || `<pre style="white-space:pre-wrap">${(email.text || '').replace(/</g, '&lt;')}</pre>`),
        text: `Forwarded from advisory@mitchhagy.com\nFrom: ${from}\n\n${email.text || ''}`
      })
    });
    return res.status(200).send('Forwarded');
  } catch (e) {
    console.error(e);
    return res.status(500).send('Forward failed: ' + (e && e.message ? e.message : String(e)));
  }
};
