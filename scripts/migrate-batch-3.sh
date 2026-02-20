#!/bin/bash

# Batch 3: Admin Services Migration
# Moves Order, Inventory, and User/Customer services to @lib/core

echo "Starting Batch 3 Migration..."

# 1. Create Directories
mkdir -p projects/core/src/lib/services
mkdir -p projects/core/src/lib/models

# 2. Move Services
echo "Moving Services..."
mv src/app/core/services/order.service.ts projects/core/src/lib/services/
mv src/app/core/services/inventory-ledger.service.ts projects/core/src/lib/services/
mv src/app/core/services/user-management.service.ts projects/core/src/lib/services/
mv src/app/core/services/staff.service.ts projects/core/src/lib/services/
mv src/app/core/services/customer-unification.service.ts projects/core/src/lib/services/

# 3. Move Models
echo "Moving Models..."
mv src/app/core/models/order.model.ts projects/core/src/lib/models/
mv src/app/core/models/inventory-ledger.model.ts projects/core/src/lib/models/
mv src/app/core/models/unified-customer.model.ts projects/core/src/lib/models/
mv src/app/core/models/staff.model.ts projects/core/src/lib/models/
# user.model.ts was already moved in Batch 1

# 4. Update Public API
echo "Updating public-api.ts..."
cat <<EOF >> projects/core/src/public-api.ts
export * from './lib/services/order.service';
export * from './lib/services/inventory-ledger.service';
export * from './lib/services/user-management.service';
export * from './lib/services/staff.service';
export * from './lib/services/customer-unification.service';
export * from './lib/models/order.model';
export * from './lib/models/inventory-ledger.model';
export * from './lib/models/unified-customer.model';
export * from './lib/models/staff.model';
EOF

# 5. Fix Relative Imports in Moved Files (Sed Magic)
echo "Fixing internal imports in moved files..."

# Fix generic relative path to models
# ../models/x -> ../models/x (No change needed if both moved)
# But if it points to something NOT moved, it breaks.
# Also imports from @lib/core need to be relative now if inside the lib? 
# No, "projects/core" tsconfig paths might not be picked up by the lib itself easily without build.
# Best practice: Use relative paths inside the lib.

# Fix imports in OrderService
# import ... from '../models/order.model' -> Valid
# import ... from '@lib/core' -> Change to relative? 
# StateRegistryService is enabled in public-api, so we can import from public-api?
# No, circular dependency risk. Better to import from relative file if possible, or keep @lib/core if tsconfig allows.
# create-batch-2 showed we can use relative paths for siblings.

# OrderService: StateRegistryService (Already in lib)
sed -i '' "s|import { StateRegistryService } from '@lib/core';|import { StateRegistryService } from './state-registry.service';|g" projects/core/src/lib/services/order.service.ts

# InventoryLedgerService: AuthService (Already in lib)
sed -i '' "s|import { AuthService } from '@lib/core';|import { AuthService } from './auth.service';|g" projects/core/src/lib/services/inventory-ledger.service.ts

# UserManagementService: UserProfile, UserRole (Already in lib)
sed -i '' "s|import { UserProfile, UserRole } from '@lib/core';|import { UserProfile, UserRole } from '../models/user.model';|g" projects/core/src/lib/services/user-management.service.ts

# StaffService: UserProfile (Already in lib)
sed -i '' "s|import { UserProfile } from '@lib/core';|import { UserProfile } from '../models/user.model';|g" projects/core/src/lib/services/staff.service.ts

# 6. Run Refactor Script for the App
echo "Running import refactoring script..."
node scripts/refactor-imports.js

echo "Batch 3 Migration Script Completed."
