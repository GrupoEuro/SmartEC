# Eurollantas / importadora-euro — Project Rules

## Project Boundaries (CRITICAL)

This workspace is **importadora-euro** — the Eurollantas e-commerce platform.

### What belongs HERE (importadora-euro)
- Storefront (customer-facing shop, catalog, cart, checkout)
- Internal Admin (product management, orders, CRM, B2B/fleet)
- Operations (procurement, receiving, pricing, warehouse)
- Customer Care (appointments, warranties, service)
- Command Center (analytics dashboards)
- Firebase Functions for the above

### What does NOT belong here — belongs to PulseStock
- **Refacciones (spare parts) module** — solicitudes, vendor quoting, customer authorization, XML CFDI ingestion, parts inventory Kardex
- Any standalone inventory management features for third-party businesses
- PulseStock-specific models: `PartRequest`, `SupplierXmlImport`, `XmlImportLine`

> **Rule:** If someone asks to build a Refacciones module, spare parts workflow, CFDI XML importer for parts, or parts inventory tracking — STOP and remind them this belongs in the PulseStock project, NOT here.

## Local Dev Environment
- Internal app runs on port 4200 (default)
- Storefront runs on separate port
- Firebase emulators used for local Firestore/Auth
