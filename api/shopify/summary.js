const { sendJson, readJson } = require('../_lib/http');
const { shopifyAdminGQL, resolveShopifyCreds } = require('../_lib/shopify');

function isoDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await readJson(req);
    const { store, adminToken } = resolveShopifyCreds(body);
    if (!adminToken) return sendJson(res, 400, { error: 'Missing Shopify Admin token' });

    const since = new Date();
    since.setDate(since.getDate() - 14);
    const sinceDay = isoDay(since);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDay = isoDay(yesterday);
    const todayDay = isoDay(new Date());

    const query = `{
      orders(first: 100, reverse: true, sortKey: PROCESSED_AT, query: "created_at:>=${sinceDay} AND financial_status:paid") {
        edges { node {
          id
          name
          createdAt
          cancelledAt
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          customer { id displayName numberOfOrders }
        }}
      }
    }`;

    const data = await shopifyAdminGQL(store, adminToken, query);
    const orders = (data.data?.orders?.edges || [])
      .map(({ node }) => ({
        id: node.id,
        name: node.name,
        createdAt: node.createdAt,
        cancelledAt: node.cancelledAt,
        total: Number(node.currentTotalPriceSet?.shopMoney?.amount || 0),
        currency: node.currentTotalPriceSet?.shopMoney?.currencyCode || 'INR',
        customerId: node.customer?.id || '',
        repeat: Number(node.customer?.numberOfOrders || 0) > 1
      }))
      .filter(order => !order.cancelledAt);

    const yesterdayOrders = orders.filter(order => isoDay(order.createdAt) === yesterdayDay);
    const todayOrders = orders.filter(order => isoDay(order.createdAt) === todayDay);
    const salesYesterday = Math.round(yesterdayOrders.reduce((sum, order) => sum + order.total, 0));
    const ordersYesterday = yesterdayOrders.length;
    const repeatYesterday = yesterdayOrders.some(order => order.repeat);
    const salesToday = Math.round(todayOrders.reduce((sum, order) => sum + order.total, 0));

    sendJson(res, 200, {
      ok: true,
      summary: {
        salesYesterday,
        ordersYesterday,
        repeatYesterday,
        salesToday,
        currency: orders[0]?.currency || 'INR',
        ordersFetched: orders.length,
        source: 'shopify-admin'
      }
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
