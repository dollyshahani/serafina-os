const { readBuffer, sendJson, getEnv, maybeLogSyncRun } = require('../_lib/http');

async function ensureBucket(supabaseUrl, serviceKey, bucket) {
  const resp = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true
    })
  });

  if (resp.ok) return;
  const text = await resp.text();
  if (resp.status === 409 || /already exists/i.test(text)) return;
  throw new Error(text || `Bucket create failed (${resp.status})`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const bucket = getEnv('SUPABASE_STORAGE_BUCKET', 'serafina-assets');
  if (!supabaseUrl || !serviceKey) {
    return sendJson(res, 500, { error: 'Supabase env vars are not configured' });
  }

  try {
    const filename = decodeURIComponent(String(req.query.filename || '')).trim();
    const contentType = String(req.query.contentType || 'application/octet-stream').trim();
    const lane = String(req.query.lane || 'serafina').trim();
    if (!filename) return sendJson(res, 400, { error: 'filename is required' });

    const bytes = await readBuffer(req);
    if (!bytes.length) return sendJson(res, 400, { error: 'file body is empty' });

    await ensureBucket(supabaseUrl, serviceKey, bucket);

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    const objectPath = `${lane}/${Date.now()}-${safeName}`;
    const uploadResp = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: bytes
    });

    if (!uploadResp.ok) {
      const text = await uploadResp.text();
      throw new Error(text || `Upload failed (${uploadResp.status})`);
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
    await maybeLogSyncRun({ source: 'content_upload', status: 'success', meta: { bucket, objectPath, lane } });
    sendJson(res, 200, { ok: true, bucket, path: objectPath, publicUrl, contentType });
  } catch (err) {
    await maybeLogSyncRun({ source: 'content_upload', status: 'error', meta: { message: err.message } });
    sendJson(res, 500, { error: err.message });
  }
};
