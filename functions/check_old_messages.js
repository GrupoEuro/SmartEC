const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'tiendapraxis'
    });
}

const db = admin.firestore();

async function checkOldMessages() {
    console.log('Checking database for messages older than July 2, 2026...');
    const July2Date = new Date('2026-07-02T00:00:00Z');

    // 1. Check customer_conversations collection dates
    const convsSnap = await db.collection('customer_conversations').get();
    console.log(`Total customer_conversations docs: ${convsSnap.size}`);

    let olderConvsCount = 0;
    let oldestConvDate = null;
    let newestConvDate = null;

    convsSnap.docs.forEach(doc => {
        const data = doc.data();
        const dateVal = data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : null);
        if (dateVal) {
            if (!oldestConvDate || dateVal < oldestConvDate) oldestConvDate = dateVal;
            if (!newestConvDate || dateVal > newestConvDate) newestConvDate = dateVal;
            if (dateVal < July2Date) olderConvsCount++;
        }
    });

    console.log(`Conversations created before July 2, 2026: ${olderConvsCount}`);
    console.log(`Oldest conversation date: ${oldestConvDate ? oldestConvDate.toISOString() : 'N/A'}`);
    console.log(`Newest conversation date: ${newestConvDate ? newestConvDate.toISOString() : 'N/A'}`);

    // 2. Check collectionGroup 'messages' across all conversations
    const messagesSnap = await db.collectionGroup('messages').get();
    console.log(`\nTotal messages found across all conversations: ${messagesSnap.size}`);

    let olderMessagesCount = 0;
    let oldestMsgDate = null;
    let newestMsgDate = null;
    const oldMessagesSample = [];

    messagesSnap.docs.forEach(doc => {
        const data = doc.data();
        const rawDate = data.timestamp || data.createdAt;
        const dateVal = rawDate?.toDate ? rawDate.toDate() : (rawDate ? new Date(rawDate) : null);
        
        if (dateVal) {
            if (!oldestMsgDate || dateVal < oldestMsgDate) oldestMsgDate = dateVal;
            if (!newestMsgDate || dateVal > newestMsgDate) newestMsgDate = dateVal;
            if (dateVal < July2Date) {
                olderMessagesCount++;
                if (oldMessagesSample.length < 5) {
                    oldMessagesSample.push({
                        id: doc.id,
                        convId: doc.ref.parent.parent ? doc.ref.parent.parent.id : 'root',
                        text: (data.text || data.content || '').slice(0, 50),
                        timestamp: dateVal.toISOString(),
                        channel: data.channel || 'N/A'
                    });
                }
            }
        }
    });

    console.log(`Messages dated before July 2, 2026: ${olderMessagesCount}`);
    console.log(`Oldest message date: ${oldestMsgDate ? oldestMsgDate.toISOString() : 'N/A'}`);
    console.log(`Newest message date: ${newestMsgDate ? newestMsgDate.toISOString() : 'N/A'}`);

    if (oldMessagesSample.length > 0) {
        console.log('\nSample messages before July 2, 2026:');
        console.log(JSON.stringify(oldMessagesSample, null, 2));
    }

    process.exit(0);
}

checkOldMessages().catch(err => {
    console.error('Error checking old messages:', err);
    process.exit(1);
});
