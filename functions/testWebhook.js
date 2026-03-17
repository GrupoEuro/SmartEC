const fetch = require('node-fetch');

async function sendWebhook(orderId) {
    const webhookUrl = 'https://us-central1-tiendapraxis.cloudfunctions.net/meliWebhook';
    console.log(`\nSending mock MercadoLibre POST request to:`);
    console.log(`-> ${webhookUrl}`);
    console.log(`-> Resource: /orders/${orderId}\n`);

    // Exact payload structure MercadoLibre sends for orders_v2
    const payload = {
        resource: `/orders/${orderId}`,
        user_id: 123456,
        topic: "orders_v2",
        application_id: 123456,
        attempts: 1,
        sent: new Date().toISOString(),
        received: new Date().toISOString()
    };

    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log(`Webhook responded with HTTP Status: ${res.status} ${res.statusText}`);
        const text = await res.text();
        console.log(`Webhook response body: ${text}`);
    } catch (e) {
        console.error("Error calling webhook:", e);
    }
}

// We will use a mock order ID. The webhook will return 200 immediately, 
// then try to fetch it in the background and fail gracefully since it's fake.
sendWebhook('9999999999');
