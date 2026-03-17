const https = require('https');

const data = JSON.stringify({ data: { dateFrom: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() } });

const options = {
  hostname: 'us-central1-tiendapraxis.cloudfunctions.net',
  port: 443,
  path: '/meliSyncOrders',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, res => {
  console.log(`statusCode: ${res.statusCode}`);

  res.on('data', d => {
    process.stdout.write(d);
  });
});

req.on('error', error => {
  console.error(error);
});

req.write(data);
req.end();
