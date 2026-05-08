const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery();

async function run() {
  try {
    const query = `SELECT source_channel, fulfillment_type, COUNT(*) as count 
                   FROM \`importadora-euro.euro_analytics.order_items\` 
                   GROUP BY source_channel, fulfillment_type`;
    const [job] = await bq.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    console.log("BigQuery Table Stats:", rows);

    const query2 = `SELECT source_channel, COUNT(*) as count 
                   FROM \`importadora-euro.euro_analytics.orders\` 
                   GROUP BY source_channel`;
    const [job2] = await bq.createQueryJob({ query: query2 });
    const [rows2] = await job2.getQueryResults();
    console.log("BigQuery Orders Stats:", rows2);

    // Get a sample Meli Full order_item
    const query3 = `SELECT * FROM \`importadora-euro.euro_analytics.order_items\` 
                    WHERE source_channel = 'MELI_FULL' LIMIT 5`;
    const [job3] = await bq.createQueryJob({ query: query3 });
    const [rows3] = await job3.getQueryResults();
    console.log("Sample MELI_FULL items:", rows3);

  } catch (err) {
    console.error(err);
  }
}
run();
