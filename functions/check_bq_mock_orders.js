const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'tiendapraxis' });

async function checkBQ() {
    console.log("Checking BigQuery for Mock Orders...");
    
    const queryOrders = `
        SELECT count(*) as count 
        FROM \`tiendapraxis.euro_analytics.orders\` 
        WHERE order_id LIKE 'ord_%'
    `;
    
    const queryItems = `
        SELECT count(*) as count 
        FROM \`tiendapraxis.euro_analytics.order_items\` 
        WHERE order_id LIKE 'ord_%'
    `;
    
    try {
        const [rowsOrders] = await bq.query(queryOrders);
        console.log(`Mock orders in BigQuery (orders table): ${rowsOrders[0].count}`);
        
        const [rowsItems] = await bq.query(queryItems);
        console.log(`Mock items in BigQuery (order_items table): ${rowsItems[0].count}`);
        
        if (rowsOrders[0].count > 0 || rowsItems[0].count > 0) {
            console.log("\nDeleting mock orders from BigQuery...");
            await bq.query(`DELETE FROM \`tiendapraxis.euro_analytics.orders\` WHERE order_id LIKE 'ord_%'`);
            await bq.query(`DELETE FROM \`tiendapraxis.euro_analytics.order_items\` WHERE order_id LIKE 'ord_%'`);
            console.log("✅ Successfully deleted mock data from BigQuery!");
        }
    } catch (e) {
        console.error("Error querying BigQuery:", e.message);
    }
}

checkBQ().catch(console.error);
