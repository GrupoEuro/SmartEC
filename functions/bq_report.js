const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'tiendapraxis' });

async function run() {
  const query = `
    SELECT 
      FORMAT_TIMESTAMP('%Y-%m', created_at) as month_year, 
      source_channel, 
      COUNT(*) as count 
    FROM \`tiendapraxis.euro_analytics.orders\` 
    WHERE source_channel IN ('MELI_CLASSIC', 'MELI_FULL') 
    GROUP BY month_year, source_channel 
    ORDER BY month_year DESC, source_channel
  `;
  try {
    const [job] = await bq.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("ERROR:", err);
  }
}
run();
