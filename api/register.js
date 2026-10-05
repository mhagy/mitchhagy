// Vercel serverless function: ENVI Professional registrations.
// Uses the same environment variables as contact.js:
//   RESEND_API_KEY, CONTACT_TO

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function send(payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const { first, last, email, business, role, stage, research, agree, company } = b || {};
  if (company) return res.status(200).json({ ok: true }); // honeypot
  if (!first || !last || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please include your name and a valid email.' });
  }
  if (!agree) return res.status(400).json({ error: 'Please accept the privacy policy to register.' });
  if (!process.env.RESEND_API_KEY || !process.env.CONTACT_TO) {
    return res.status(500).json({ error: 'Missing RESEND_API_KEY or CONTACT_TO environment variable' });
  }

  const name = `${first} ${last}`;
  try {
    await send({
      from: 'MGH Advisory <advisory@mghagy.com>',
      to: [process.env.CONTACT_TO],
      reply_to: email,
      subject: `ENVI registration: ${name}`,
      html: `<h2>New ENVI&trade; Professional registration</h2>
        <p><strong>Name:</strong> ${esc(name)}</p>
        <p><strong>Email:</strong> ${esc(email)}</p>
        <p><strong>Business:</strong> ${esc(business)}</p>
        <p><strong>Role:</strong> ${esc(role)}</p>
        <p><strong>Stage:</strong> ${esc(stage)}</p>
        <p><strong>Open to research contact:</strong> ${research ? 'Yes' : 'No'}</p>
        <p><strong>Registered:</strong> ${new Date().toISOString()}</p>`
    });
    await send({
      from: 'MGH Advisory <advisory@mghagy.com>',
      to: [email],
      subject: 'You are registered for the ENVI™ Professional assessment',
      html: `<p>Hi ${esc(first)},</p>
        <p>Thank you for registering for the free ENVI&trade; (Entrepreneurial Neuro-Value Index) Professional assessment.</p>
        <p>You will receive your personal access link by email as soon as your spot opens. Registered founders and owners get first access.</p>
        <p>Talk soon,<br>M.G. Hagy, MBA, PhD (ABD)<br>MGH Small Business Advisor · mghagy.com</p>`
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Email service error', detail: String(e.message || e) });
  }
};
