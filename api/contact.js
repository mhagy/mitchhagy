// Vercel serverless function: sends consultation requests through Resend.
// Requires environment variables in Vercel:
//   RESEND_API_KEY  - your Resend API key (Secret)
//   CONTACT_TO      - inbox that should receive requests (e.g. admin@aeonnci.com)

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { name, email, stage, message, company } = body || {};

  // Simple honeypot: bots fill hidden "company" field.
  if (company) return res.status(200).json({ ok: true });

  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please include your name and a valid email.' });
  }

  const html = `
    <h2>New consultation request</h2>
    <p><strong>Name:</strong> ${esc(name)}</p>
    <p><strong>Email:</strong> ${esc(email)}</p>
    <p><strong>Stage:</strong> ${esc(stage)}</p>
    <p><strong>Message:</strong><br>${esc(message).replace(/\n/g, '<br>')}</p>
  `;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MGH Advisory <advisory@mitchhagy.com>',
        to: [process.env.CONTACT_TO],
        reply_to: email,
        subject: `Consultation request from ${name}`,
        html
      })
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('Resend error', t);
      return res.status(502).json({ error: 'Email service error' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
};
