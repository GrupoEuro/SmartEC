const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkCoverImages() {
    console.log('🔍 Checking blog posts for cover images...\n');

    try {
        const snapshot = await db.collection('blog_posts').get();

        if (snapshot.empty) {
            console.log('❌ No blog posts found!');
            return;
        }

        console.log(`📊 Found ${snapshot.size} blog post(s)\n`);

        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`\nTitle: "${data.title}"`);
            console.log(`ID: ${doc.id}`);
            console.log(`CoverImage: ${data.coverImage || 'MISSING'}`);
            
            if (data.coverImage && data.coverImage.length > 100) {
                 console.log(`(URL length: ${data.coverImage.length})`);
            }
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
    
    // exit
    process.exit(0);
}

checkCoverImages();
