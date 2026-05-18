const fs = require('fs');
const os = require('os');
const path = require('path');

async function run() {
    const p = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const token = data.tokens.access_token;
    
    const ids = [
        "2000013018679589", "2000013018477213", "2000013018267135", "2000016467366092",
        "2000016466286008", "2000013016708205", "2000013016642157", "2000013016138417",
        "2000013015707735", "2000013015496997", "2000013015606685", "2000013015575229",
        "2000016464953036", "2000016464848402", "2000013015252043", "2000013015092237",
        "2000013015082785", "2000013014990817", "2000013014837113", "2000013014276905",
        "2000013011994375", "2000013014437945", "2000013014265445", "2000013014137811",
        "2000013014080669", "2000013012939025", "2000013012683941", "2000013012169825",
        "2000016461218286", "2000013011228717", "2000013011016397", "2000013009106217",
        "2000013009024761", "2000013008903867"
    ];
    
    let missingIds = [];
    let foundCount = 0;
    
    const headers = { 'Authorization': 'Bearer ' + token };
    
    for (const id of ids) {
        // Try getting document directly
        let res = await fetch(`https://firestore.googleapis.com/v1/projects/tiendapraxis/databases/(default)/documents/orders/meli_${id}`, { headers });
        if (res.ok) {
            foundCount++;
            continue;
        }
        
        // If not found, try runQuery
        const query = {
            "structuredQuery": {
                "from": [{"collectionId": "orders"}],
                "where": {
                    "compositeFilter": {
                        "op": "OR",
                        "filters": [
                            {
                                "fieldFilter": {
                                    "field": {"fieldPath": "externalOrderId"},
                                    "op": "EQUAL",
                                    "value": {"stringValue": String(id)}
                                }
                            },
                            {
                                "fieldFilter": {
                                    "field": {"fieldPath": "meliPackId"},
                                    "op": "EQUAL",
                                    "value": {"integerValue": id}
                                }
                            }
                        ]
                    }
                },
                "limit": 1
            }
        };
        res = await fetch(`https://firestore.googleapis.com/v1/projects/tiendapraxis/databases/(default)/documents:runQuery`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(query)
        });
        
        if (res.ok) {
            const data = await res.json();
            if (data.length > 0 && data[0].document) {
                foundCount++;
                continue;
            }
        }
        
        missingIds.push(id);
    }
    
    console.log(`Found: ${foundCount}/${ids.length}`);
    console.log("Missing IDs:", missingIds);
}

run().catch(console.error);
