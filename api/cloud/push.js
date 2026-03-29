const { readJson, sendJson, getEnv, maybeLogSyncRun } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return sendJson(res, 500, { error: 'Supabase env vars are not configured' });
  }

  try {
    const body = await readJson(req);
    const workspace = String(body.workspace || '').trim();
    const snapshot = body.snapshot || {};
    if (!workspace) return sendJson(res, 400, { error: 'workspace is required' });

    const resp = await fetch(`${supabaseUrl}/rest/v1/app_snapshots?on_conflict=workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify([{
        workspace,
        payload: snapshot,
        updated_at: new Date().toISOString()
      }])
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `Supabase HTTP ${resp.status}`);
    }

    await maybeLogSyncRun({ source: 'cloud_push', status: 'success', meta: { workspace } });
    sendJson(res, 200, { ok: true, workspace });
  } catch (err) {
    await maybeLogSyncRun({ source: 'cloud_push', status: 'error', meta: { message: err.message } });
    sendJson(res, 500, { error: err.message });
  }
};
