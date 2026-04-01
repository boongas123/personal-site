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

const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID } = process.env;
if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
  console.error(JSON.stringify({ error: 'Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID in .env' }));
  process.exit(1);
}

async function fetchMetaAds() {
  try {
    const url = `https://graph.facebook.com/v19.0/${META_AD_ACCOUNT_ID}/insights`;
    const params = {
      fields: 'spend,purchase_roas,actions,action_values',
      time_range: JSON.stringify({ since: date, until: date }),
      access_token: META_ACCESS_TOKEN,
    };

    const { data } = await axios.get(url, { params });
    const row = data.data && data.data[0];

    if (!row) {
      console.log(JSON.stringify({ spend: 0, revenue: 0, roas: 0, purchases: 0, date }));
      return;
    }

    const spend = parseFloat(row.spend || 0);

    // Extract purchase revenue from action_values
    const revenue = (row.action_values || [])
      .filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase')
      .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

    // Extract purchase count from actions
    const purchases = (row.actions || [])
      .filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase')
      .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

    const roas = spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0;

    console.log(JSON.stringify({ spend, revenue, roas, purchases, date }));
  } catch (err) {
    const message = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(JSON.stringify({ error: message, date }));
    process.exit(1);
  }
}

fetchMetaAds();
