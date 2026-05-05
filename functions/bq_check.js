const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'tiendapraxis' });

async function check() {
  const query = `
    SELECT order_id, order_date, status, source_channel, total, subtotal, shipping_cost, discount
    FROM \`tiendapraxis.euro_analytics.orders\`
    WHERE source_channel = 'WEB' AND total < 100
    ORDER BY order_date DESC
    LIMIT 20
  `;
  const [rows] = await bq.query(query);
  console.log("Found:", rows.length);
  console.table(rows);
}
check().catch(console.error);
