const fs = require('fs');
const os = require('os');
const path = require('path');

async function run() {
    const p = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const token = data.tokens.access_token;
    
    const headers = { 'Authorization': 'Bearer ' + token };
    
    const query = {
        "structuredQuery": {
            "from": [{"collectionId": "orders"}],
            "orderBy": [{"field": {"fieldPath": "createdAt"}, "direction": "DESCENDING"}],
            "limit": 5
        }
    };
    
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/tiendapraxis/databases/(default)/documents:runQuery`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(query)
    });
    
    if (res.ok) {
        const docs = await res.json();
        for (const d of docs) {
            if (d.document) {
                console.log("ID:", d.document.name.split('/').pop());
                const fields = d.document.fields;
                console.log("  externalOrderId:", fields.externalOrderId ? fields.externalOrderId.stringValue : 'N/A');
                console.log("  meliPackId:", fields.meliPackId ? fields.meliPackId.integerValue : 'N/A');
                console.log("  total:", fields.total ? fields.total.integerValue || fields.total.doubleValue : 'N/A');
                console.log("  status:", fields.status ? fields.status.stringValue : 'N/A');
                console.log("  createdAt:", fields.createdAt ? fields.createdAt.timestampValue : 'N/A');
                console.log("  sourceChannel:", fields.sourceChannel ? fields.sourceChannel.stringValue : 'N/A');
                console.log("---");
            }
        }
    } else {
        console.error("Failed to fetch:", res.status, await res.text());
    }
}

run().catch(console.error);
