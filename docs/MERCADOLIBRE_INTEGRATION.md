# MercadoLibre Integration Docs

**Status**: Phase 1 Complete (Historic Sync)
**Last Updated**: January 2025
**Module**: `Src/Core/Services/MeliOrderService`

## 1. Overview
This integration connects the platform with MercadoLibre (MeLi) to enable:
1.  **Historic Sales Archival**: Downloading past sales data for analytics.
2.  **Order Synchronization**: Real-time order importing (Polling/Webhooks planned).
3.  **Inventory Management**: Bi-directional stock sync (Planned).

## 2. Historic Data Mining (The "Time Machine")

### Logic
Located in `MeliOrderService.syncHistoricOrders(year, sellerId)`.

To bypass MeLi's pagination limits (offset > 1000 is often restricted), we implement a **Month-by-Month Chunking Strategy**:
1.  Iterate from Month 0 (Jan) to Month 11 (Dec).
2.  Generate `date_created.from` and `date_created.to` ISO timestamps.
3.  Fetch orders using the Search API with `limit=50` and `offset` paging within that month.
4.  Stop when no more results are returned for the month or limits are hit.

### Data Mapping
We map incoming MeLi orders to our internal `Order` schema with specific enhancements for analytics:

| Field | Mapping | Notes |
| :--- | :--- | :--- |
| `status` | `mapStatus(mOrder)` | Maps "delivered" -> `completed` to avoid cluttering active queue. |
| `paymentStatus` | `'paid'` | Historic orders are assumed paid. |
| `metadata.shipping_cost` | `shipping.cost` | Crucial for Net Profit calculation. |
| `metadata.original_status` | `mOrder.status` | Preserves source of truth. |
| `is_historic` | `true` | (Boolean) Flag to exclude from operational dashboards. |

### Usage
-   **Trigger**: Button "Sync 2025" in Admin > Settings > Integrations.
-   **Permission**: Requires a valid `access_token` stored in `SecretsService`.

## 3. Future Roadmap (The "Brain")

### Phase 2: Predictive Dashboard
Using the data mined in Phase 1:
-   **Sales Velocity**: Calculate items sold per day (adjusted for stockouts).
-   **Price Elasticity**: Correlate historic price changes with sales volume.
-   **Regional Heatmaps**: Map sales by `shipping.receiver_address.state`.

### Phase 3: Bi-Directional Sync
-   **Stock Push**: Listen to `InventoryService` changes -> Push to `/items/{id}`.
-   **Smart Pricing**: Push prices from the "Price Constructor" module.

## 4. Technical Configuration
-   **App ID / Secret**: Stored in `configs/general` (Firestore) via `SecretsService`.
-   **Redirect URI**: `/admin/settings/integrations/callback`.
