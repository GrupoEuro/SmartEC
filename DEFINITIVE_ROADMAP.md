# Importadora Euro - Definitive Roadmap (v2026)

**Vision**: Transform the platform from a "Management Tool" into an "Intelligent Assistant" that proactively drives business decisions.

---

## 📍 Phase 1: Core Functionality (✅ STABLE - v1.0)
*Foundation laid. Maintenance mode.*
- [x] Public E-commerce Storefront
- [x] Admin Panel (CMS, PIM, CRM)
- [x] Operations Portal (Fulfillment v1)
- [x] Command Center (Basic Analytics)

---

## 📍 Phase 2: Advanced Operations & Pricing (🚧 IN PROGRESS - v1.1)
*Current focus area. Goal: Revenue Optimization.*

### 2.1 Pricing Intelligence Engine
*Status: Active Development*
-   **Dynamic Pricing Matrix**: Calculate final prices based on Channel Fees (Meli/Amazon), Shipping Tables, and Net Margins.
-   **Bulk Policy Manager**: Apply "Cost + 15%" rules to entire categories.
-   **Rounding Rules**: Psychology-based pricing (e.g., end in .99 or .90).

### 2.2 Warehouse & Locator v2.0
*Status: Active Development*
-   **Grid-Based Layout**: Exact coordinate mapping for Racks/Bins (removing ambiguous 3D scattering).
-   **Visual Stock Heatmap**: Color-coded racks based on capacity (Red=Full, Green=Empty).

---

## 📍 Phase 3: The Connected Ecosystem (NEXT - v1.2)
*Goal: Omnichannel Synchronization.*

### 3.1 Trustable Integrations (Marketplaces)
Direct, reliable synchronization avoiding fragile scrapers.
-   **MercadoLibre**:
    -   *Resource*: **Official MercadoLibre SDK (Node.js)** & API v2.
    -   *Feature*: Real-time stock sync (Webhook listening).
    -   *Feature*: Question & Answer bot assistant.
-   **Amazon SP-API**:
    -   *Resource*: **Amazon Selling Partner API** (Tokens/STS).
    -   *Feature*: FBA Inventory reconciliation.

### 3.2 Notification Center (Central Nervous System)
-   **Event Bus**: Central service to dispatch alerts (Toast, Email, Push).
-   **Triggers**:
    -   "Stockout in 3 days"
    -   "High Value Order Received > $5,000"
    -   "Margin Error: Price below Cost"

---

## 📍 Phase 4: Intelligence & Speed (FUTURE - v2.0)
*Goal: "State of the Art" User Experience.*

### 4.1 Global Command Palette (Cmd+K)
*Instant navigation without clicking menus.*
-   **Technology**: **Orama** (formerly Lyra) - A next-gen, edge-ready, full-text search engine that runs *entirely in the browser* with no latency.
-   *Capability*: Index 10,000 products + orders in <20MB RAM.
-   *User Flow*: Press `Cmd+K` -> Type "Mich Pilot" -> Jump directly to Product Edit Page.

### 4.2 AI Sales Forecasting (Client-Side ML)
*Predict demand without heavy server costs.*
-   **Technology**: **TensorFlow.js** (Lightweight Layers Model).
-   *Implementation*: Train a small model purely in the browser using the user's last 24 months of sales data (CSV/JSON).
-   *Output*: "Suggested Reorder Qty" displayed directly on the Inventory Restock table.

### 4.3 Mobile PWA Scanner
*Turn any phone into a Zebra scanner.*
-   **Technology**: **Barcode Detection API** (Native Chrome/Android) fallback to **ZXing-js**.
-   *Feature*: "Scan Mode" in Operations UI. Camera opens in-app, scans SKU, auto-increments "Packed" count.

### 4.4 Smart Customer Insights
-   **Technology**: **Simple-Statistics** (Linear Regression/Clustering).
-   *Feature*: **Churn Prediction**. Detect customers who haven't ordered in (Average Frequency + 2SD).
-   *Feature*: **Cohort Analysis**. "Jan 2025 signups have 20% higher LTV than Dec 2024".

---

## 📅 Execution Timeline

| Version | Scope | est. Delivery |
| :--- | :--- | :--- |
| **v1.0** | Stable Core (Current) | **Live** |
| **v1.1** | Pricing Engine & Locator Polish | **Q1 2026** |
| **v1.2** | Meli/Amazon Integrations | **Q2 2026** |
| **v2.0** | AI Forecasting & Cmd+K Search | **Q3 2026** |
