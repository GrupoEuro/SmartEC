# Firestore Security Rules for E-Commerce

Add these rules to your `firestore.rules` file:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth != null && 
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['ADMIN', 'SUPER_ADMIN'];
    }
    
    // Categories Collection
    match /categories/{categoryId} {
      // Anyone can read active categories
      allow read: if resource.data.active == true || isAdmin();
      
      // Only admins can create, update, delete
      allow create, update, delete: if isAdmin();
    }
    
    // Brands Collection
    match /brands/{brandId} {
      // Anyone can read active brands
      allow read: if resource.data.active == true || isAdmin();
      
      // Only admins can create, update, delete
      allow create, update, delete: if isAdmin();
    }
    
    // Products Collection
    match /products/{productId} {
      // Anyone can read active products
      allow read: if resource.data.active == true || isAdmin();
      
      // Only admins can create, update, delete
      allow create, update, delete: if isAdmin();
    }

    // Customers Collection
    match /customers/{customerId} {
      // Admins can read/write everything
      allow read, write: if isAdmin();
      
      // Customers can read/write their own data
      allow read, write: if request.auth != null && request.auth.uid == customerId;
    }

    // Orders Collection
    match /orders/{orderId} {
      // Admins can read/write everything
      allow read, write: if isAdmin();
      
      // Customers can read their own orders
      allow read: if request.auth != null && resource.data.customer.id == request.auth.uid;
      // Customers can create orders (simplified for now)
      allow create: if request.auth != null;
    }

    // Coupons Collection
    match /coupons/{couponId} {
      // Everyone can read active coupons (for applying codes)
      allow read: if resource.data.isActive == true || isAdmin();
      // Only admins can write
      allow write: if isAdmin();
    }
  }
}
```

## Firestore Indexes

Create these composite indexes in Firebase Console or `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "categories",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "active", "order": "ASCENDING" },
        { "fieldPath": "order", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "categories",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "parentId", "order": "ASCENDING" },
        { "fieldPath": "order", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "categoryId", "order": "ASCENDING" },
        { "fieldPath": "active", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "brand", "order": "ASCENDING" },
        { "fieldPath": "active", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "featured", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "active", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "active", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "inStock", "order": "ASCENDING" },
        { "fieldPath": "featured", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

## Storage Rules

Add these rules to your `storage.rules` file:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth != null && 
             firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.role in ['ADMIN', 'SUPER_ADMIN'];
    }
    
    // Category images
    match /categories/{allPaths=**} {
      allow read: if true; // Public read
      allow write: if isAdmin(); // Only admins can upload/delete
    }
    
    // Product images
    match /products/{allPaths=**} {
      allow read: if true; // Public read
      allow write: if isAdmin(); // Only admins can upload/delete
    }
  }
}
```

## Deploy Rules

```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Storage rules
firebase deploy --only storage

# Deploy indexes
firebase deploy --only firestore:indexes
```
