'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

// Parse --date YYYY-MM-DD from CLI args
const dateArg = process.argv.indexOf('--date');
if (dateArg === -1 || !process.argv[dateArg + 1]) {
  console.error(JSON.stringify({ error: 'Missing --date YYYY-MM-DD argument' }));
  process.exit(1);
}
const date = process.argv[dateArg + 1];

const { SHOPIFY_SHOP, SHOPIFY_ACCESS_TOKEN } = process.env;
if (!SHOPIFY_SHOP || !SHOPIFY_ACCESS_TOKEN) {
  console.error(JSON.stringify({ error: 'Missing SHOPIFY_SHOP or SHOPIFY_ACCESS_TOKEN in .env' }));
  process.exit(1);
}

async function fetchShopifyOrders() {
  try {
    const url = `https://${SHOPIFY_SHOP}/admin/api/2024-01/orders.json`;
    let allOrders = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data } = await axios.get(url, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
        params: {
          created_at_min: `${date}T00:00:00`,
          created_at_max: `${date}T23:59:59`,
          status: 'any',
          limit: 250,
          page,
        },
      });

      const orders = data.orders || [];
      allOrders = allOrders.concat(orders);
      hasMore = orders.length === 250;
      page++;
    }

    // Aggregate
    const orderCount = allOrders.length;
    const grossSales = allOrders.reduce((sum, o) => {
      return sum + parseFloat(o.total_price || 0);
    }, 0);
    const avgOrderValue = orderCount > 0
      ? parseFloat((grossSales / orderCount).toFixed(2))
      : 0;

    console.log(JSON.stringify({
      grossSales: parseFloat(grossSales.toFixed(2)),
      orderCount,
      avgOrderValue,
      date,
    }));
  } catch (err) {
    const message = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(JSON.stringify({ error: message, date }));
    process.exit(1);
  }
}

fetchShopifyOrders();
