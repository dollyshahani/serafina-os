const { readJson, sendJson, maybeLogSyncRun } = require('../_lib/http');
const { shopifyGQL, resolveShopifyCreds } = require('../_lib/shopify');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await readJson(req);
    const { store, token } = resolveShopifyCreds(body);
    const data = await shopifyGQL(store, token, '{ shop { name primaryDomain { url } } }');
    await maybeLogSyncRun({ source: 'shopify_test', status: 'success', meta: { store } });
    sendJson(res, 200, { ok: true, shop: data.data?.shop || null });
  } catch (err) {
    await maybeLogSyncRun({ source: 'shopify_test', status: 'error', meta: { message: err.message } });
    sendJson(res, 500, { error: err.message });
  }
};
