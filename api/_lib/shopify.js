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

function resolveShopifyCreds(body = {}) {
  return {
    store: body.store || getEnv('SHOPIFY_STORE'),
    token: body.token || getEnv('SHOPIFY_STOREFRONT_TOKEN')
  };
}

module.exports = { shopifyGQL, resolveShopifyCreds };
