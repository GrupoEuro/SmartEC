# How to Check Firestore Database for Avatar URLs

## Option 1: Firebase Console (Easiest)

1. Go to https://console.firebase.google.com
2. Select your project: **tiendapraxis**
3. Click **Firestore Database** in left menu
4. Click on **blog_posts** collection
5. You should see all your blog post documents

**For EACH document:**
- Click on it to expand
- Look at the `author` field
- Expand the `author` object
- Check the `avatar` field value

**What you should see:**
```
author
  ├─ name: "Equipo Eurollantas"
  ├─ avatar: "E"  ← Should be JUST "E", not a URL
  └─ role: "Expertos en Llantas"
```

**If you see a URL like:**
```
avatar: "https://ui-avatars.com/api/?name=Eurollantas&background=0D8ABC&color=fff"
```

**Then:**
1. Click the pencil icon next to `avatar`
2. Delete the URL
3. Type just: `E`
4. Click Save
5. Repeat for ALL blog posts

---

## Option 2: Run Diagnostic Script

If you want to check all posts at once:

### Step 1: Download Service Account Key
1. Go to Firebase Console → Project Settings (gear icon)
2. Click **Service accounts** tab
3. Click **Generate new private key**
4. Save the JSON file as `serviceAccountKey.json` in your project root

### Step 2: Install Firebase Admin SDK
```bash
npm install firebase-admin
```

### Step 3: Run the Script
```bash
node check-blog-data.js
```

This will show you ALL blog posts and highlight any with URL issues.

---

## Option 3: Browser Console Query

1. Open your website: https://tiendapraxis.web.app
2. Open DevTools (F12)
3. Go to **Console** tab
4. Paste this code and press Enter:

```javascript
// This will show you what data the browser is receiving
fetch('/__/firebase/init.json')
  .then(r => r.json())
  .then(config => {
    console.log('Checking blog posts...');
    // Note: This requires the site to be loaded with Firebase SDK
  });
```

---

## What to Look For

### ❌ WRONG:
```json
{
  "author": {
    "avatar": "https://ui-avatars.com/api/?name=Eurollantas&background=0D8ABC&color=fff"
  }
}
```

### ✅ CORRECT:
```json
{
  "author": {
    "avatar": "E"
  }
}
```

---

## After Fixing

1. Wait 1-2 minutes for Firestore to propagate changes
2. Clear browser cache again
3. Hard refresh (Cmd+Shift+R or Ctrl+Shift+R)
4. Check the blog page

---

## Still Not Working?

If you've verified the Firestore data is correct and cleared cache:

1. **Check Network Tab:**
   - Open DevTools → Network tab
   - Refresh the page
   - Look for Firestore requests
   - Click on them and check the response data

2. **Try Different Browser:**
   - Open in a completely different browser
   - If it works there, it's definitely cache

3. **Check Service Worker:**
   - DevTools → Application → Service Workers
   - Click "Unregister"
   - Refresh page

4. **Screenshot and Share:**
   - Take screenshot of Firestore console showing the `author` object
   - Take screenshot of Network tab showing Firestore response
   - This will help identify the exact issue
