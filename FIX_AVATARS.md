# How to Fix Blog Avatar URLs

The blog posts in Firestore have old avatar URLs (like `https://ui-avatars.com/api/?...`) instead of simple initials like "E".

## Quick Fix

Run this command to fix all blog posts:

```bash
# Install firebase-admin if not already installed
npm install firebase-admin

# Run the fix script
node fix-blog-avatars.js
```

## What it does

The script will:
1. Check all blog posts in the `blog_posts` collection
2. Find any avatars that contain URLs
3. Replace them with just "E"
4. Report how many were fixed

## Alternative: Manual Fix via Firebase Console

If you prefer to fix manually:

1. Go to Firebase Console → Firestore Database
2. Open the `blog_posts` collection
3. For each document:
   - Click on the document
   - Find `author.avatar` field
   - Change the value from the URL to just `E`
   - Save

## After Fixing

Once the avatars are fixed in Firestore:
1. Refresh the blog page in your browser
2. The avatar circles should show just "E" instead of the long URL
3. The layout will be clean and readable
