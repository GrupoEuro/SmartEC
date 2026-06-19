const https = require('https');

const data = JSON.stringify({
    topic: 'orders_v2',
    resource: '/orders/2000016528011810'
});

const options = {
    hostname: 'us-central1-tiendapraxis.cloudfunctions.net',
    port: 443,
    path: '/meliWebhook',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    
    let responseData = '';
    res.on('data', chunk => { responseData += chunk; });
    res.on('end', () => {
        console.log('Response:', responseData);
    });
});

req.on('error', (err) => {
    console.error('Error:', err.message);
});

req.write(data);
req.end();
