const { sendJson, getEnv, maybeLogSyncRun } = require('../_lib/http');
const { shopifyGQL } = require('../_lib/shopify');

module.exports = async function handler(req, res) {
  const cronSecret = getEnv('CRON_SECRET');
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const isVercelCron = Boolean(req.headers['x-vercel-cron']);

  if (!isVercelCron && cronSecret && bearer !== cronSecret) {
    return sendJson(res, 401, { error: 'Unauthorized cron request' });
  }

  const store = getEnv('SHOPIFY_STORE');
  const token = getEnv('SHOPIFY_STOREFRONT_TOKEN');

  try {
    let productCount = null;
    if (store && token) {
      const data = await shopifyGQL(store, token, '{ products(first: 1) { edges { node { id } } } }');
      productCount = Array.isArray(data.data?.products?.edges) ? data.data.products.edges.length : 0;
    }

    await maybeLogSyncRun({
      source: 'vercel_cron',
      status: 'success',
      meta: { storeConfigured: Boolean(store && token), productCount }
    });

    sendJson(res, 200, { ok: true, ranAt: new Date().toISOString(), productCount });
  } catch (err) {
    await maybeLogSyncRun({ source: 'vercel_cron', status: 'error', meta: { message: err.message } });
    sendJson(res, 500, { error: err.message });
  }
};
