const { readJson, sendJson, maybeLogSyncRun } = require('../_lib/http');
const { shopifyGQL, resolveShopifyCreds } = require('../_lib/shopify');

const QUERY = `{
  products(first: 100) {
    edges { node {
      id
      title
      handle
      totalInventory
      variants(first: 1) { edges { node { sku price { amount } quantityAvailable } } }
      images(first: 1) { edges { node { url } } }
    }}
  }
}`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await readJson(req);
    const { store, token } = resolveShopifyCreds(body);
    const data = await shopifyGQL(store, token, QUERY);
    const products = (data.data?.products?.edges || []).map(({ node }) => {
      const variant = node.variants?.edges?.[0]?.node || {};
      return {
        id: node.id,
        title: node.title,
        handle: node.handle,
        sku: variant.sku || node.handle,
        price: variant.price?.amount || 0,
        qty: node.totalInventory ?? variant.quantityAvailable ?? 0,
        img: node.images?.edges?.[0]?.node?.url || ''
      };
    });
    await maybeLogSyncRun({ source: 'shopify_sync', status: 'success', meta: { count: products.length, store } });
    sendJson(res, 200, { ok: true, products });
  } catch (err) {
    await maybeLogSyncRun({ source: 'shopify_sync', status: 'error', meta: { message: err.message } });
    sendJson(res, 500, { error: err.message });
  }
};
