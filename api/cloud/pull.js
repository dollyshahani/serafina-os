const { sendJson, getEnv, maybeLogSyncRun } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return sendJson(res, 500, { error: 'Supabase env vars are not configured' });
  }

  const workspace = String(req.query.workspace || '').trim();
  if (!workspace) return sendJson(res, 400, { error: 'workspace is required' });

  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/app_snapshots?workspace=eq.${encodeURIComponent(workspace)}&select=workspace,payload,updated_at&limit=1`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      }
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `Supabase HTTP ${resp.status}`);
    }

    const rows = await resp.json();
    const row = rows[0];
    if (!row) return sendJson(res, 404, { error: 'No snapshot found for workspace' });

    await maybeLogSyncRun({ source: 'cloud_pull', status: 'success', meta: { workspace } });
    sendJson(res, 200, { ok: true, workspace, snapshot: row.payload || {}, updatedAt: row.updated_at });
  } catch (err) {
    await maybeLogSyncRun({ source: 'cloud_pull', status: 'error', meta: { message: err.message, workspace } });
    sendJson(res, 500, { error: err.message });
  }
};
