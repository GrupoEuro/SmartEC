#!/bin/bash

# Move Services
mv src/app/core/services/product.service.ts projects/core/src/lib/services/
mv src/app/core/services/cart.service.ts projects/core/src/lib/services/
mv src/app/core/services/category.service.ts projects/core/src/lib/services/
mv src/app/core/services/brand.service.ts projects/core/src/lib/services/

# Move Models
mv src/app/core/models/catalog.model.ts projects/core/src/lib/models/
mv src/app/core/models/cart.model.ts projects/core/src/lib/models/
mv src/app/core/models/product.model.ts projects/core/src/lib/models/

# Update public-api.ts
cat <<EOF >> projects/core/src/public-api.ts
export * from './lib/services/product.service';
export * from './lib/services/cart.service';
export * from './lib/services/category.service';
export * from './lib/services/brand.service';
export * from './lib/models/catalog.model';
export * from './lib/models/cart.model';
export * from './lib/models/product.model';
EOF

# Update Imports in App
# Update Imports using find + sed for robustness

# 1. Services - Replace relative imports from within core/services (./service)
find src/app/core/services -name "*.ts" -exec sed -i '' "s|from '\./product\.service'|from '@lib/core'|g" {} +
find src/app/core/services -name "*.ts" -exec sed -i '' "s|from '\./cart\.service'|from '@lib/core'|g" {} +
find src/app/core/services -name "*.ts" -exec sed -i '' "s|from '\./category\.service'|from '@lib/core'|g" {} +
find src/app/core/services -name "*.ts" -exec sed -i '' "s|from '\./brand\.service'|from '@lib/core'|g" {} +

# 2. Services - Replace parent imports from other locations (../services/service or ../../core/services/service)
# We use a broad regex replacement for the module name mostly, but let's be specific to avoid false positives
# Pattern: from '.../services/product.service' -> from '@lib/core'
# This covers ../services/product.service, ../../services/product.service, src/app/core/services/product.service
find src/app -name "*.ts" -exec sed -i '' "s|from '.*\/services/product\.service'|from '@lib/core'|g" {} +
find src/app -name "*.ts" -exec sed -i '' "s|from '.*\/services/cart\.service'|from '@lib/core'|g" {} +
find src/app -name "*.ts" -exec sed -i '' "s|from '.*\/services/category\.service'|from '@lib/core'|g" {} +
find src/app -name "*.ts" -exec sed -i '' "s|from '.*\/services/brand\.service'|from '@lib/core'|g" {} +

# 3. Models - Replace relative imports from within core/models (./model)
find src/app/core/models -name "*.ts" -exec sed -i '' "s|from '\./catalog\.model'|from '@lib/core'|g" {} +
find src/app/core/models -name "*.ts" -exec sed -i '' "s|from '\./cart\.model'|from '@lib/core'|g" {} +
find src/app/core/models -name "*.ts" -exec sed -i '' "s|from '\./product\.model'|from '@lib/core'|g" {} +

# 4. Models - Replace parent imports (../models/model or ../../core/models/model)
find src/app -name "*.ts" -exec sed -i '' "s|from '.*\/models/catalog\.model'|from '@lib/core'|g" {} +
find src/app -name "*.ts" -exec sed -i '' "s|from '.*\/models/cart\.model'|from '@lib/core'|g" {} +
find src/app -name "*.ts" -exec sed -i '' "s|from '.*\/models/product\.model'|from '@lib/core'|g" {} +

# Add siblings logic for core/services (if any file left there uses them)
# But we are moving them all out?
# Only `order.service.ts` etc left.

echo "Batch 2 Migration Script Completed"
