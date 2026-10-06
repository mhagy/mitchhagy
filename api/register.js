// Vercel serverless function: ENVI Professional registrations.
// Uses the same environment variables as contact.js:
//   RESEND_API_KEY, CONTACT_TO
// Plus, to send founders their AEON access link automatically:
//   ENVI_PRO_INVITE_SECRET - must match the value set in the AEON (aeonnci.com) Vercel project
// If that secret is missing or AEON is unreachable, registration still succeeds
// and the founder is told their link will follow (send it manually from AEON).

const AEON_INVITE_URL = 'https://aeonnci.com/api/envi-pro/invite';

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

// Asks AEON to create the invite and email the founder their personal link.
// Returns { ok, detail } and never throws.
async function createAeonInvite({ first, last, email, business, role, stage, research }) {
  if (!process.env.ENVI_PRO_INVITE_SECRET) return { ok: false, detail: 'ENVI_PRO_INVITE_SECRET not set' };
  try {
    const r = await fetch(AEON_INVITE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-envi-secret': process.env.ENVI_PRO_INVITE_SECRET },
      body: JSON.stringify({
        email,
        first_name: first,
        last_name: last,
        business_name: business,
        role,
        business_stage: stage,
        research_interest: !!research
      })
    });
    const body = await r.json().catch(() => ({}));
    // 201 = invite created and emailed; anything else means the founder has no link yet.
    if (r.status === 201 && body.emailed) return { ok: true, detail: 'Invite sent' };
    return { ok: false, detail: `AEON responded ${r.status}: ${body.error || (body.emailed === false ? 'invite created, email failed' : 'unknown')}` };
  } catch (e) {
    return { ok: false, detail: `AEON unreachable: ${String(e.message || e)}` };
  }
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
  const invite = await createAeonInvite({ first, last, email, business, role, stage, research });

  try {
    await send({
      from: 'MGH Advisory <advisory@mghagy.com>',
      to: [process.env.CONTACT_TO],
      reply_to: email,
      subject: `ENVI registration: ${name}${invite.ok ? '' : ' (ACTION: send link manually)'}`,
      html: `<h2>New ENVI&trade; Professional registration</h2>
        <p><strong>Name:</strong> ${esc(name)}</p>
        <p><strong>Email:</strong> ${esc(email)}</p>
        <p><strong>Business:</strong> ${esc(business)}</p>
        <p><strong>Role:</strong> ${esc(role)}</p>
        <p><strong>Stage:</strong> ${esc(stage)}</p>
        <p><strong>Open to research contact:</strong> ${research ? 'Yes' : 'No'}</p>
        <p><strong>AEON access link:</strong> ${invite.ok ? 'Sent automatically' : `NOT sent (${esc(invite.detail)})`}</p>
        <p><strong>Registered:</strong> ${new Date().toISOString()}</p>`
    });
    await send({
      from: 'MGH Advisory <advisory@mghagy.com>',
      to: [email],
      subject: 'You are registered for the ENVI™ Professional assessment',
      html: `<p>Hi ${esc(first)},</p>
        <p>Thank you for registering for the free ENVI&trade; (Entrepreneurial Neuro-Value Index) Professional assessment.</p>
        ${invite.ok
          ? '<p>Your personal access link has been sent in a separate email from <strong>AEON NCI</strong> (noreply@aeonnci.com). If you don\'t see it within a few minutes, please check your spam or promotions folder.</p>'
          : '<p>You will receive your personal access link by email as soon as your spot opens. Registered founders and owners get first access.</p>'}
        <p>Talk soon,<br>M.G. Hagy, MBA, PhD (ABD)<br>MGH Small Business Advisor · mghagy.com</p>`
    });
    return res.status(200).json({ ok: true, linkSent: invite.ok });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Email service error', detail: String(e.message || e) });
  }
};
