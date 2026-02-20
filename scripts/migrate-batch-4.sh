#!/bin/bash

# Batch 4: UI Components Migration to @lib/ui-kit

REPO_ROOT="/Volumes/MacData/Projects/Eurollantas/Website/importadora-euro"
cd "$REPO_ROOT" || exit

echo "Starting Batch 4 Migration (UI Components)..."

# 1. Create Directories in UI Kit
echo "Creating directories in @lib/ui-kit..."
mkdir -p projects/ui-kit/src/lib/atoms/app-icon
mkdir -p projects/ui-kit/src/lib/molecules/metric-chart
mkdir -p projects/ui-kit/src/lib/organisms/chart-card
mkdir -p projects/ui-kit/src/lib/config

# 2. Move Files
echo "Moving files..."

# Atoms: App Icon
mv src/app/shared/components/app-icon/* projects/ui-kit/src/lib/atoms/app-icon/
# Molecules: Metric Chart
mv src/app/shared/components/metric-chart/* projects/ui-kit/src/lib/molecules/metric-chart/
# Organisms: Chart Card
mv src/app/shared/components/chart-card/* projects/ui-kit/src/lib/organisms/chart-card/
# Config: Chart Theme
mv src/app/core/config/chart-theme.ts projects/ui-kit/src/lib/config/

# 3. Clean up empty source directories
rm -rf src/app/shared/components/app-icon
rm -rf src/app/shared/components/metric-chart
rm -rf src/app/shared/components/chart-card

# 4. Update Public API
echo "Updating projects/ui-kit/src/public-api.ts..."
cat <<EOF >> projects/ui-kit/src/public-api.ts

// Config
export * from './lib/config/chart-theme';

// Atoms
export * from './lib/atoms/app-icon/app-icon.component';
export * from './lib/atoms/app-icon/icons';

// Molecules
export * from './lib/molecules/metric-chart/metric-chart.component';

// Organisms
export * from './lib/organisms/chart-card/chart-card.component';
EOF

# 5. Fix Internal Imports (Relative paths within UI Kit)
echo "Fixing internal imports..."

# Fix MetricChart importing ChartTheme
# Old: import { CHART_THEME } from '../../../core/config/chart-theme';
# New path: lib/molecules/metric-chart/metric-chart.component.ts -> lib/config/chart-theme.ts
# Relative: ../../config/chart-theme
sed -i '' "s|import { CHART_THEME } from '../../../core/config/chart-theme';|import { CHART_THEME } from '../../config/chart-theme';|g" projects/ui-kit/src/lib/molecules/metric-chart/metric-chart.component.ts

# Fix ChartCard importing AppIcon and MetricChart
# Old: import { AppIconComponent } from '../app-icon/app-icon.component';
# New path: lib/organisms/chart-card/chart-card.component.ts -> lib/atoms/app-icon/app-icon.component
# Relative: ../../atoms/app-icon/app-icon.component
sed -i '' "s|import { AppIconComponent } from '../app-icon/app-icon.component';|import { AppIconComponent } from '../../atoms/app-icon/app-icon.component';|g" projects/ui-kit/src/lib/organisms/chart-card/chart-card.component.ts

# Old: import { MetricChartComponent } from '../metric-chart/metric-chart.component';
# New path: lib/organisms/chart-card/chart-card.component.ts -> lib/molecules/metric-chart/metric-chart.component
# Relative: ../../molecules/metric-chart/metric-chart.component
sed -i '' "s|import { MetricChartComponent } from '../metric-chart/metric-chart.component';|import { MetricChartComponent } from '../../molecules/metric-chart/metric-chart.component';|g" projects/ui-kit/src/lib/organisms/chart-card/chart-card.component.ts

# Fix KPI Card (still in app) importing AppIcon - WILL BE HANDLED BY REFACTOR SCRIPT IF MAPPED
# But since KPI Card is staying in app, it will need to import from @lib/ui-kit.
# The refactor-imports.js script should handle this if we add the mapping.

echo "Batch 4 Migration Script Completed."
