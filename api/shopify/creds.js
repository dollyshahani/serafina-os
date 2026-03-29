const { sendJson, getEnv } = require('../_lib/http');

module.exports = async function handler(req, res) {
  const store = getEnv('SHOPIFY_STORE');
  const token = getEnv('SHOPIFY_STOREFRONT_TOKEN');
  sendJson(res, 200, {
    store: store || null,
    token: token || null
  });
};
