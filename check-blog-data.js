// Run this script to check all blog posts in Firestore
// Usage: node check-blog-data.js

const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json'); // You'll need to download this from Firebase Console

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkBlogPosts() {
    console.log('🔍 Checking all blog posts for avatar URLs...\n');

    try {
        const snapshot = await db.collection('blog_posts').get();

        if (snapshot.empty) {
            console.log('❌ No blog posts found in database!');
            return;
        }

        console.log(`📊 Found ${snapshot.size} blog post(s)\n`);

        let foundIssues = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            const postId = doc.id;
            const title = data.title || 'Untitled';
            const author = data.author || {};

            console.log(`\n📝 Post: "${title}"`);
            console.log(`   ID: ${postId}`);
            console.log(`   Slug: ${data.slug || 'N/A'}`);
            console.log(`   Author Name: ${author.name || 'N/A'}`);
            console.log(`   Author Avatar: ${author.avatar || 'N/A'}`);
            console.log(`   Author Role: ${author.role || 'N/A'}`);

            // Check if avatar contains a URL
            if (author.avatar && (author.avatar.includes('http') || author.avatar.includes('ui-avatars'))) {
                console.log(`   ⚠️  WARNING: Avatar contains URL!`);
                console.log(`   🔧 Should be: "E" (or other initials)`);
                foundIssues = true;
            } else if (author.avatar && author.avatar.length <= 3) {
                console.log(`   ✅ Avatar looks correct (text initials)`);
            } else if (author.avatar) {
                console.log(`   ⚠️  Avatar is longer than expected: "${author.avatar}"`);
                foundIssues = true;
            } else {
                console.log(`   ❌ Avatar is missing!`);
                foundIssues = true;
            }
        });

        console.log('\n' + '='.repeat(60));
        if (foundIssues) {
            console.log('❌ Issues found! See warnings above.');
            console.log('💡 Fix: Update the avatar field to just "E" in Firestore Console');
        } else {
            console.log('✅ All blog posts look good!');
            console.log('💡 If you still see URLs, it\'s a browser cache issue.');
        }
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

checkBlogPosts();
