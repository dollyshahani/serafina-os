const crypto = require('crypto');
const { sendJson, getEnv, maybeLogSyncRun } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const secret = getEnv('SHOPIFY_WEBHOOK_SECRET');
  if (!secret) return sendJson(res, 500, { error: 'SHOPIFY_WEBHOOK_SECRET is not configured' });

  try {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    await new Promise((resolve, reject) => {
      req.on('end', resolve);
      req.on('error', reject);
    });

    const digest = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
    const provided = req.headers['x-shopify-hmac-sha256'];
    if (!provided || !crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(provided))) {
      return sendJson(res, 401, { error: 'Invalid webhook signature' });
    }

    const supabaseUrl = getEnv('SUPABASE_URL');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceKey) {
      await fetch(`${supabaseUrl}/rest/v1/webhook_events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=minimal'
        },
        body: JSON.stringify([{
          provider: 'shopify',
          topic: req.headers['x-shopify-topic'] || 'unknown',
          payload: raw ? JSON.parse(raw) : {},
          received_at: new Date().toISOString()
        }])
      });
    }

    await maybeLogSyncRun({ source: 'shopify_webhook', status: 'success', meta: { topic: req.headers['x-shopify-topic'] || 'unknown' } });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    await maybeLogSyncRun({ source: 'shopify_webhook', status: 'error', meta: { message: err.message } });
    sendJson(res, 500, { error: err.message });
  }
};
