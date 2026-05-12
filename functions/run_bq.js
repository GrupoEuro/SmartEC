const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery();

async function run() {
  const query = `
    SELECT 
      FORMAT_TIMESTAMP('%Y-%m', created_at) as month_year, 
      source_channel, 
      COUNT(*) as count 
    FROM \`importadora-euro.euro_analytics.orders\` 
    WHERE source_channel IN ('MELI', 'MELI_FULL') 
    GROUP BY month_year, source_channel 
    ORDER BY month_year DESC, source_channel
  `;
  try {
    const [job] = await bq.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    console.log("RESULTS:", JSON.stringify(rows));
  } catch (err) {
    console.error("ERROR:", err);
  }
  process.exit(0);
}
run();
