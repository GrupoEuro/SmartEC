const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery();

async function run() {
  const query = `
    SELECT column_name, data_type 
    FROM \`importadora-euro.euro_analytics.INFORMATION_SCHEMA.COLUMNS\` 
    WHERE table_name = 'orders'
  `;
  const [job] = await bq.createQueryJob({ query });
  const [rows] = await job.getQueryResults();
  console.log(rows);
}
run();
