const admin = require('firebase-admin');
admin.initializeApp();

async function run() {
    const db = admin.firestore();
    const snapshot = await db.collection('meli_communications').get();
    
    console.log(`Found ${snapshot.size} Meli Communications. Processing...`);
    let count = 0;
    
    for (const doc of snapshot.docs) {
        const commData = doc.data();
        const topic = commData.topic; // 'messages' or 'questions'
        const rawData = commData.data;
        if (!rawData) continue;
        
        let conversationId = '';
        let channelConversationId = '';
        let customerName = 'Cliente ML';
        let customerHandle = '';
        let messageText = '';
        let platformMessageId = '';
        let msgTimestamp = admin.firestore.FieldValue.serverTimestamp();
        let tag = '';
        
        if (topic === 'messages') {
            const packId = rawData.message_attachments?.pack_id || rawData.message_attachments?.order_id || rawData.resource_id;
            const senderId = rawData.from?.user_id || rawData.from?.id || rawData.sender_id;
            if (!packId || !senderId) continue;
            
            conversationId = `meli_msg_${packId}`;
            channelConversationId = String(packId);
            customerHandle = String(senderId);
            customerName = rawData.from?.name || 'Cliente ML';
            messageText = rawData.text?.plain || rawData.text || '';
            platformMessageId = rawData.id || `msg_${Date.now()}`;
            if (rawData.message_date?.created) {
                msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.message_date.created));
            } else if (rawData.date_created) {
                msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
            }
            tag = 'Post-Venta';
            
        } else if (topic === 'questions') {
            const itemId = rawData.item_id;
            const senderId = rawData.from?.id;
            if (!itemId || !senderId) continue;
            
            conversationId = `meli_q_${itemId}_${senderId}`;
            channelConversationId = `${itemId}_${senderId}`;
            customerHandle = String(senderId);
            messageText = rawData.text || '';
            platformMessageId = rawData.id || `q_${Date.now()}`;
            if (rawData.date_created) {
                msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
            }
            tag = 'Pre-Venta';
        } else {
            continue;
        }
        
        if (!messageText) continue;
        
        const convRef = db.collection('customer_conversations').doc(conversationId);
        
        await convRef.set({
            id: conversationId,
            channel: 'mercadolibre',
            channelConversationId,
            customerName,
            customerHandle,
            status: 'open',
            priority: 'normal',
            unreadCount: admin.firestore.FieldValue.increment(1),
            tags: admin.firestore.FieldValue.arrayUnion(tag),
            lastMessage: {
                text: messageText,
                direction: 'inbound',
                timestamp: msgTimestamp
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        const convSnap = await convRef.get();
        if (convSnap.exists && !convSnap.data()?.createdAt) {
             await convRef.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        
        const msgRef = convRef.collection('messages').doc(String(platformMessageId));
        await msgRef.set({
            id: String(platformMessageId),
            direction: 'inbound',
            type: 'text',
            content: messageText,
            platformMessageId: String(platformMessageId),
            status: 'delivered',
            timestamp: msgTimestamp
        });
        count++;
    }
    console.log(`Backfilled ${count} communications!`);
}

run().catch(console.error).finally(() => process.exit(0));
