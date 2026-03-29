const { getEnv } = require('./http');

async function shopifyGQL(store, token, query) {
  if (!store || !token) {
    throw new Error('Missing Shopify store or token');
  }

  const resp = await fetch(`https://${store}/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': token
    },
    body: JSON.stringify({ query })
  });

  if (!resp.ok) {
    throw new Error(`Shopify HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (json.errors) {
    throw new Error(json.errors[0]?.message || 'Shopify GraphQL error');
  }
  return json;
}

async function shopifyAdminGQL(store, token, query) {
  if (!store || !token) {
    throw new Error('Missing Shopify store or admin token');
  }

  const resp = await fetch(`https://${store}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query })
  });

  if (!resp.ok) {
    throw new Error(`Shopify Admin HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (json.errors) {
    throw new Error(json.errors[0]?.message || 'Shopify Admin GraphQL error');
  }
  return json;
}

function resolveShopifyCreds(body = {}) {
  return {
    store: body.store || getEnv('SHOPIFY_STORE'),
    token: body.token || getEnv('SHOPIFY_STOREFRONT_TOKEN'),
    adminToken: body.adminToken || getEnv('SHOPIFY_ADMIN_TOKEN')
  };
}

module.exports = { shopifyGQL, shopifyAdminGQL, resolveShopifyCreds };
