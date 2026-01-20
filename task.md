# Active Tasks: v1.1 Push (Pricing & Locator)

## ✅ 0. Image & Media Architecture (COMPLETED)
- [x] **Admin Media Library**
    - [x] Create `media_assets` Firestore collection & Service.
    - [x] Build Media Library UI (Gallery, Upload, Filters).
    - [x] Implement Reusable Media Picker Dialog.
    - [x] Create Folder Tree Component
- [x] **Frontend Optimization**
    - [x] Integrate `NgOptimizedImage` (`ngSrc`) in Catalog.
    - [x] Integrate `NgOptimizedImage` in Home.
    - [x] Verify Production Build.

## 🚧 1. Customer Login Optimization (Immediate Focus)
- [x] **UI Polish**
    - [x] Remove "(TEST)" from header.
    - [x] Replace SVG with `AppIconComponent`.
    - [x] Verify Mobile Responsiveness.
- [x] **Code Cleanup**
    - [x] Implement `ToastService` for errors.
    - [x] Review `AuthService.syncUserProfile`.

## 🚧 2. Product Locator v2.0 (Polish)
- [ ] **Grid Layout**
    - [ ] Confirm "Green Dot" alignment in 2D grid.
    - [ ] Verify "Rack Heatmap" colors (Green/Yellow/Red).
- [ ] **Data Consistency**
    - [ ] Ensure `DataSeeder` correctly populates `warehouse_locations` with new coordinate format.

## 🔮 3. Preparation for v1.2 (Integrations)
- [x] **MercadoLibre Research**
- [x] **Historic Data Sync (2025)** <!-- implemented -->
- [ ] **Predictive Reports Dashboard**
    - [ ] Locate API Keys/Tokens in `environment.ts` or secure storage.
    - [ ] Create `MeliService` skeleton.
    - [ ] Test simple "Get User" or "List Items" call via Proxy/Direct.

## 🧠 4. Research for v2.0 (Innovation)
- [ ] **Search PoC**
    - [ ] Install `orama` npm package.
    - [ ] Create a small demo indexing 100 products in memory.
- [ ] **Forecasting PoC**
    - [ ] Create `ForecastingService`.
    - [ ] Implement simple moving average as baseline.

---

## ✅ Completed (Recent)
- [x] **Project State Review**: Created Definitive Roadmap.
- [x] **Core Stability**: Confirmed v1.0 Production Readiness.
