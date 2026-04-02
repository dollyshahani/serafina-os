const { sendJson, getEnv } = require('./_lib/http');

module.exports = async function handler(req, res) {
  sendJson(res, 200, {
    ok: true,
    features: {
      cloudSync: Boolean(getEnv('SUPABASE_URL') && getEnv('SUPABASE_SERVICE_ROLE_KEY')),
      contentStorage: Boolean(getEnv('SUPABASE_URL') && getEnv('SUPABASE_SERVICE_ROLE_KEY')),
      localIntake: Boolean(getEnv('SUPABASE_URL') && getEnv('SUPABASE_SERVICE_ROLE_KEY') && process.env.VERCEL !== '1'),
      localShopifyPull: process.env.VERCEL !== '1',
      managedShopify: Boolean(getEnv('SHOPIFY_STORE') && getEnv('SHOPIFY_STOREFRONT_TOKEN')),
      shopifyAdmin: Boolean(getEnv('SHOPIFY_STORE') && getEnv('SHOPIFY_ADMIN_TOKEN')),
      vercelCron: false,
      reelVision: Boolean(getEnv('OPENAI_API_KEY')),
      higgsfieldVideo: Boolean(getEnv('HIGGSFIELD_API_KEY') && getEnv('HIGGSFIELD_API_SECRET')),
      exhibitionSearch: true
    }
  });
};
