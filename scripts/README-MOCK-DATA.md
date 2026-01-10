# Mock Data Population Script

This script populates your Firestore database with realistic motorcycle tire data for testing.

## What It Creates

### **5 Brands**
- Praxis (Mexico) - Featured
- Michelin (France) - Featured
- Pirelli (Italy) - Featured
- Dunlop (UK)
- Bridgestone (Japan)

### **4 Categories**
- Sport 🏍️
- Touring 🛣️
- Off-Road ⛰️
- Scooter 🛴

### **8+ Products**
Realistic motorcycle tires with:
- Complete specifications (width, aspect ratio, diameter, load index, speed rating)
- Bilingual names and descriptions (EN/ES)
- Features lists
- Pricing (some with discounts)
- Stock quantities
- Product badges (Featured, New Arrival, Best Seller)
- Placeholder images

## How to Run

### **Prerequisites**
1. You need a Firebase service account key file
2. Node.js installed

### **Steps**

1. **Get your Firebase service account key**:
   - Go to Firebase Console → Project Settings → Service Accounts
   - Click "Generate new private key"
   - Save the file as `serviceAccountKey.json` in the `scripts/` directory

2. **Install Firebase Admin SDK** (if not already installed):
   ```bash
   npm install firebase-admin
   ```

3. **Run the script**:
   ```bash
   cd scripts
   node populate-mock-data.js
   ```

4. **Verify the data**:
   - Check Firebase Console → Firestore Database
   - Or visit your admin pages:
     - `/admin/brands`
     - `/admin/categories`
     - `/admin/products`

## What You Can Test After Running

✅ **Admin Pages**:
- Brand list and forms
- Category list and forms
- Product list and forms
- Edit/delete operations

✅ **Public Pages**:
- Catalog with filters and search
- Product detail pages
- Related products
- Category filtering

✅ **Features**:
- Search functionality
- Price filtering
- Tire size filtering
- Brand filtering
- Product badges
- Stock status
- Discounts

## Sample Product IDs

After running, you can test product detail pages by:
1. Going to `/catalog`
2. Clicking "View Details" on any product
3. Or manually navigate to `/product/{id}` (get ID from Firestore)

## Clean Up

To remove all mock data:
```javascript
// Run this in Firebase Console or create a cleanup script
const collections = ['brands', 'categories', 'products'];
collections.forEach(async (col) => {
    const snapshot = await db.collection(col).get();
    snapshot.docs.forEach(doc => doc.ref.delete());
});
```

## Notes

- All images use placeholder URLs (via.placeholder.com)
- You can replace these with real tire images later
- Prices are in your local currency
- Stock quantities are realistic for testing
- Some products are marked as featured, new arrivals, or bestsellers for testing badges
