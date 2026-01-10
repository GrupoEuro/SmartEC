// Script to fix avatar URLs in blog posts
// This will update all blog posts that have ui-avatars.com URLs to just use "E"

const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function fixAvatarURLs() {
    console.log('🔧 Fixing avatar URLs in blog posts...\n');

    try {
        const snapshot = await db.collection('blog_posts').get();

        if (snapshot.empty) {
            console.log('❌ No blog posts found!');
            return;
        }

        console.log(`📊 Found ${snapshot.size} blog post(s)\n`);

        let fixedCount = 0;
        let alreadyCorrect = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const postId = doc.id;
            const title = data.title || 'Untitled';
            const author = data.author || {};

            console.log(`\n📝 Checking: "${title}"`);
            console.log(`   Current avatar: ${author.avatar || 'N/A'}`);

            // Check if avatar contains a URL
            if (author.avatar && (author.avatar.includes('http') || author.avatar.includes('ui-avatars'))) {
                console.log(`   ⚠️  Found URL! Fixing...`);

                // Update to just "E"
                await doc.ref.update({
                    'author.avatar': 'E'
                });

                console.log(`   ✅ Fixed! Updated to "E"`);
                fixedCount++;
            } else if (author.avatar && author.avatar.length <= 3) {
                console.log(`   ✅ Already correct (using initials)`);
                alreadyCorrect++;
            } else {
                console.log(`   ⚠️  Avatar missing or invalid: "${author.avatar}"`);

                // Set to "E" if missing
                await doc.ref.update({
                    'author.avatar': 'E'
                });

                console.log(`   ✅ Set to "E"`);
                fixedCount++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log(`✅ Done! Fixed ${fixedCount} post(s)`);
        console.log(`✅ ${alreadyCorrect} post(s) were already correct`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

fixAvatarURLs();
