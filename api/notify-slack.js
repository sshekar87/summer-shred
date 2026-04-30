// Vercel serverless function: POST /api/notify-slack
// Accepts { type: 'feedback' | 'quote_suggestion', data: {...} }
// Forwards to Slack incoming webhook (URL stored in SLACK_WEBHOOK_URL env var).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    return res.status(500).json({ error: 'SLACK_WEBHOOK_URL not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const type = body && body.type;
  const data = (body && body.data) || {};

  let blocks;
  if (type === 'feedback') {
    blocks = formatFeedback(data);
  } else if (type === 'quote_suggestion') {
    blocks = formatQuote(data);
  } else {
    return res.status(400).json({ error: 'Unknown type' });
  }

  try {
    const slackRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    if (!slackRes.ok) {
      const text = await slackRes.text().catch(() => '');
      return res.status(502).json({ error: 'Slack rejected', detail: text.slice(0, 200) });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'Slack request failed', detail: String(e).slice(0, 200) });
  }
}

function safe(s, max = 1000) {
  return String(s == null ? '' : s).slice(0, max);
}

function formatFeedback(d) {
  const stars = Math.max(0, Math.min(5, parseInt(d.rating, 10) || 0));
  const starStr = '⭐'.repeat(stars) + '☆'.repeat(5 - stars);
  const message = safe(d.message, 1500) || '_(no message)_';
  const email = safe(d.userEmail, 200) || 'anonymous';
  const ts = safe(d.timestamp, 50) || new Date().toISOString();
  return [
    { type: 'header', text: { type: 'plain_text', text: '💬 Live B.I.G — Feedback' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Rating:* ${starStr}  (${stars}/5)\n*Message:* ${message}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `From: ${email} · ${ts}` }] },
  ];
}

function formatQuote(d) {
  const text = safe(d.text, 1500);
  const author = safe(d.author, 200) || 'Anonymous';
  const email = safe(d.userEmail, 200) || 'anonymous';
  const ts = safe(d.timestamp, 50) || new Date().toISOString();
  return [
    { type: 'header', text: { type: 'plain_text', text: '✨ Live B.I.G — Quote Suggestion' } },
    { type: 'section', text: { type: 'mrkdwn', text: `> ${text}\n— *${author}*` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Submitted by: ${email} · ${ts}` }] },
  ];
}
