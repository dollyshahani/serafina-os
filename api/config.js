const { sendJson, getEnv } = require('./_lib/http');

module.exports = async function handler(req, res) {
  sendJson(res, 200, {
    ok: true,
    features: {
      cloudSync: Boolean(getEnv('SUPABASE_URL') && getEnv('SUPABASE_SERVICE_ROLE_KEY')),
      contentStorage: Boolean(getEnv('SUPABASE_URL') && getEnv('SUPABASE_SERVICE_ROLE_KEY')),
      localIntake: Boolean(getEnv('SUPABASE_URL') && getEnv('SUPABASE_SERVICE_ROLE_KEY') && process.env.VERCEL !== '1'),
      managedShopify: Boolean(getEnv('SHOPIFY_STORE') && getEnv('SHOPIFY_STOREFRONT_TOKEN')),
      vercelCron: true,
      reelVision: Boolean(getEnv('OPENAI_API_KEY'))
    }
  });
};
