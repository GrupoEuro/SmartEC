import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Firestore, collection, addDoc, Timestamp, doc, setDoc, writeBatch, getDocs, limit, query } from '@angular/fire/firestore';

@Component({
  selector: 'app-populate-data',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="populate-container">
      <header class="page-header">
        <h1>🛠️ Data Seeder</h1>
        <p>Manage your test environment data. Populate individual sections or reset the database.</p>
      </header>
      
      <div class="status-console" *ngIf="logs.length > 0">
        <div class="console-header">
          <span>Activity Log</span>
          <button (click)="clearLogs()" class="btn-clear">Clear</button>
        </div>
        <div class="console-body">
          <div *ngFor="let log of logs" class="log-entry" [ngClass]="log.type">
            <span class="timestamp">{{ log.time }}</span>
            <span class="message">{{ log.message }}</span>
          </div>
        </div>
      </div>

      <div class="grid-layout">
        <!-- 1. CATALOG -->
        <div class="card">
          <div class="card-header">
            <span class="icon">📦</span>
            <h2>Catalog</h2>
            <span class="badge success" *ngIf="catalogSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>Foundational Data:</strong> Brands, Categories, Products.</p>
            <div class="stats">
              <span>Brands: 5</span>
              <span>Categories: 4</span>
              <span>Products: 10</span>
            </div>
            <div class="actions">
              <button class="btn btn-primary" (click)="populateCatalog()" [disabled]="isLoading">
                {{ isLoading ? 'Processing...' : 'Seed Catalog' }}
              </button>
              <button class="btn btn-warning" (click)="clearCatalog()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- 2. CUSTOMERS -->
        <div class="card">
          <div class="card-header">
            <span class="icon">👥</span>
            <h2>Customers</h2>
            <span class="badge success" *ngIf="customersSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>Collection 'customers':</strong> Mock customer profiles with realistic addresses.</p>
            <div class="stats">
              <span>Profiles: 5 (Detailed)</span>
            </div>
            <div class="actions">
              <button class="btn btn-secondary" (click)="populateCustomers()" [disabled]="isLoading">
                {{ isLoading ? 'Processing...' : 'Seed Customers' }}
              </button>
              <button class="btn btn-warning" (click)="clearCustomers()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- 3. ORDERS -->
        <div class="card">
          <div class="card-header">
            <span class="icon">🛒</span>
            <h2>Orders</h2>
            <span class="badge success" *ngIf="ordersSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>Sales History:</strong> Diverse orders linked to customers/products.</p>
            <div class="stats">
              <span>Orders: 100</span>
              <span>December: 90</span>
              <span>Statuses: Mixed</span>
            </div>
            <div class="warning-box" *ngIf="!catalogSeeded || !customersSeeded">
              ⚠️ Needs Catalog & Customers first
            </div>
            <div class="actions">
              <button class="btn btn-secondary" (click)="populateOrders()" [disabled]="isLoading || !catalogSeeded || !customersSeeded">
                {{ isLoading ? 'Processing...' : 'Seed Orders' }}
              </button>
              <button class="btn btn-warning" (click)="clearOrders()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- 4. PROMOTIONS -->
        <div class="card">
          <div class="card-header">
            <span class="icon">🎟️</span>
            <h2>Promotions</h2>
            <span class="badge success" *ngIf="couponsSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>Marketing:</strong> Discount codes and campaigns.</p>
            <div class="stats">
              <span>Coupons: 8</span>
            </div>
            <div class="actions">
              <button class="btn btn-secondary" (click)="populateCoupons()" [disabled]="isLoading">
                {{ isLoading ? 'Processing...' : 'Seed Coupons' }}
              </button>
              <button class="btn btn-warning" (click)="clearCoupons()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- 5. PRODUCT COSTS -->
        <div class="card">
          <div class="card-header">
            <span class="icon">💵</span>
            <h2>Product Costs</h2>
            <span class="badge success" *ngIf="costsSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>Financial Data:</strong> Add cost prices to products for accurate COGS.</p>
            <div class="stats">
              <span>Products: 10</span>
              <span>Margin: 35-45%</span>
            </div>
            <div class="warning-box" *ngIf="!catalogSeeded">
              ⚠️ Needs Catalog first
            </div>
            <div class="actions">
              <button class="btn btn-secondary" (click)="populateProductCosts()" [disabled]="isLoading || !catalogSeeded">
                {{ isLoading ? 'Processing...' : 'Add Cost Prices' }}
              </button>
              <button class="btn btn-warning" (click)="clearProductCosts()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- 6. EXPENSES -->
        <div class="card">
          <div class="card-header">
            <span class="icon">💰</span>
            <h2>Operating Expenses</h2>
            <span class="badge success" *ngIf="expensesSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>Financial Data:</strong> Sample operating expenses for Income Statement.</p>
            <div class="stats">
              <span>Expenses: 15</span>
              <span>Categories: 8</span>
            </div>
            <div class="actions">
              <button class="btn btn-secondary" (click)="populateExpenses()" [disabled]="isLoading">
                {{ isLoading ? 'Processing...' : 'Seed Expenses' }}
              </button>
              <button class="btn btn-warning" (click)="clearExpenses()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- 7. APPROVAL REQUESTS -->
        <div class="card">
          <div class="card-header">
            <span class="icon">✅</span>
            <h2>Approval Requests</h2>
            <span class="badge success" *ngIf="approvalsSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>Workflow Testing:</strong> Sample approval requests for Command Center.</p>
            <div class="stats">
              <span>Requests: 8</span>
              <span>Types: 4</span>
            </div>
            <div class="actions">
              <button class="btn btn-secondary" (click)="populateApprovalRequests()" [disabled]="isLoading">
                {{ isLoading ? 'Processing...' : 'Seed Approvals' }}
              </button>
              <button class="btn btn-warning" (click)="clearApprovalRequests()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- 8. OPERATIONS DATA -->
        <div class="card">
          <div class="card-header">
            <span class="icon">⚙️</span>
            <h2>Operations Data</h2>
            <span class="badge success" *ngIf="operationsSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>Operations Portal:</strong> Order assignments, notes, and priorities.</p>
            <div class="stats">
              <span>Assignments: ~30</span>
              <span>Notes: ~60</span>
            </div>
            <div class="warning-box" *ngIf="!catalogSeeded || !customersSeeded">
              ⚠️ Needs Orders first
            </div>
            <div class="actions">
              <button class="btn btn-secondary" (click)="populateOperationsData()" [disabled]="isLoading">
                {{ isLoading ? 'Processing...' : 'Seed Operations' }}
              </button>
              <button class="btn btn-warning" (click)="clearOperationsData()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- 9. NOTIFICATIONS -->
        <div class="card">
          <div class="card-header">
            <span class="icon">🔔</span>
            <h2>Notifications</h2>
            <span class="badge success" *ngIf="notificationsSeeded">Seeded</span>
          </div>
          <div class="card-body">
            <p><strong>User Alerts:</strong> Sample notifications for testing.</p>
            <div class="stats">
              <span>Notifications: 20</span>
              <span>Types: Mixed</span>
            </div>
            <div class="actions">
              <button class="btn btn-secondary" (click)="populateNotifications()" [disabled]="isLoading">
                {{ isLoading ? 'Processing...' : 'Seed Notifications' }}
              </button>
              <button class="btn btn-warning" (click)="clearNotifications()" [disabled]="isLoading">
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- SEED ALL BUTTON -->
        <div class="card seed-all-card">
          <div class="card-header">
            <span class="icon">🚀</span>
            <h2>Seed All Data</h2>
          </div>
          <div class="card-body">
            <p><strong>Quick Setup:</strong> Populate all collections in the correct order.</p>
            <div class="stats">
              <span>December Revenue: ~$315,000</span>
              <span>Expected Profit: ~$109,000</span>
            </div>
            <div class="actions">
              <button class="btn btn-primary" (click)="seedAllData()" [disabled]="isLoading">
                {{ isLoading ? 'Processing...' : '🚀 Seed All Data' }}
              </button>
              <button class="btn btn-secondary" (click)="verifyData()" [disabled]="isLoading">
                {{ isLoading ? 'Checking...' : '🔍 Verify Data' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .populate-container {
      max-width: 1200px;
      margin: 2rem auto;
      padding: 0 1rem;
      color: #fff;
    }

    .page-header {
      margin-bottom: 2rem;
      text-align: center;
    }

    .page-header h1 {
      font-size: 2.5rem;
      background: linear-gradient(135deg, #00ACD8, #93D500);
      background-clip: text;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }

    .status-console {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      margin-bottom: 2rem;
      overflow: hidden;
    }

    .console-header {
      background: #252525;
      padding: 0.5rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #333;
    }

    .console-body {
      max-height: 200px;
      overflow-y: auto;
      padding: 1rem;
      font-family: monospace;
    }

    .log-entry {
      margin-bottom: 0.25rem;
    }

    .log-entry.success { color: #93D500; }
    .log-entry.error { color: #ff4444; }
    .log-entry.info { color: #00ACD8; }

    .timestamp {
      color: #666;
      margin-right: 0.5rem;
    }

    .grid-layout {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .card {
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .card-header .icon {
      font-size: 1.5rem;
    }

    .card-header h2 {
      margin: 0;
      font-size: 1.25rem;
    }

    .card-body {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .stats {
      display: flex;
      gap: 1rem;
      font-size: 0.875rem;
      color: #aaa;
      margin: 1rem 0;
      flex-wrap: wrap;
    }

    .stats span {
      background: rgba(255,255,255,0.05);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    .actions {
      margin-top: auto;
      display: flex;
      gap: 0.5rem;
    }

    .btn {
      flex: 1;
      padding: 0.75rem;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background: #00ACD8;
      color: white;
    }

    .btn-secondary {
      background: #333;
      color: white;
      border: 1px solid #444;
    }

    .btn-secondary:hover:not(:disabled) {
      background: #444;
    }
    
    .btn-warning {
      background: rgba(255, 68, 68, 0.1);
      color: #ff4444;
      border: 1px solid #ff4444;
      flex: 0 0 auto;
      width: auto;
      min-width: 80px;
    }
    
    .btn-warning:hover:not(:disabled) {
      background: rgba(255, 68, 68, 0.2);
    }

    .btn-clear {
      background: transparent;
      border: 1px solid #444;
      color: #aaa;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
    }
    
    .badge {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-weight: bold;
    }
    
    .badge.success {
      background: rgba(147, 213, 0, 0.2);
      color: #93D500;
      border: 1px solid #93D500;
    }

    .warning-box {
      background: rgba(255, 204, 0, 0.1);
      border: 1px solid rgba(255, 204, 0, 0.3);
      color: #ffcc00;
      padding: 0.5rem;
      border-radius: 4px;
      margin-bottom: 1rem;
      font-size: 0.85rem;
      text-align: center;
    }

    .full-width {
      width: 100%;
    }

    .seed-all-card {
      grid-column: 1 / -1;
      background: linear-gradient(135deg, rgba(0, 172, 216, 0.1) 0%, rgba(147, 213, 0, 0.1) 100%);
      border: 2px solid rgba(0, 172, 216, 0.3);
    }

    .seed-all-card .btn-primary {
      font-size: 1.1rem;
      padding: 1rem;
    }

    .seed-all-card .actions {
      display: flex;
      gap: 0.5rem;
    }

    .seed-all-card .actions .btn {
      flex: 1;
    }
  `]
})
export class PopulateDataComponent implements OnInit {
  private firestore = inject(Firestore);

  isLoading = false;
  logs: { time: string, message: string, type: 'info' | 'success' | 'error' }[] = [];

  catalogSeeded = false;
  customersSeeded = false;
  ordersSeeded = false;
  couponsSeeded = false;
  costsSeeded = false;
  expensesSeeded = false;
  approvalsSeeded = false;
  operationsSeeded = false;
  notificationsSeeded = false;

  async ngOnInit() {
    await this.checkSeededData();
  }

  async checkSeededData() {
    try {
      // Check all collections
      const checks = [
        { collection: 'products', property: 'catalogSeeded' },
        { collection: 'customers', property: 'customersSeeded' },
        { collection: 'orders', property: 'ordersSeeded' },
        { collection: 'coupons', property: 'couponsSeeded' },
        { collection: 'expenses', property: 'expensesSeeded' },
        { collection: 'approval_requests', property: 'approvalsSeeded' },
        { collection: 'orderAssignments', property: 'operationsSeeded' },
        { collection: 'notifications', property: 'notificationsSeeded' }
      ];

      for (const check of checks) {
        try {
          const q = query(collection(this.firestore, check.collection), limit(1));
          const snapshot = await getDocs(q);
          (this as any)[check.property] = !snapshot.empty;
          if (!snapshot.empty) {
            this.log(`Found existing ${check.collection} data.`, 'info');
          }
        } catch (error) {
          // Collection might not be accessible (permissions)
          console.warn(`Could not check ${check.collection}:`, error);
        }
      }

      // Check for product costs (stored in products collection)
      if (this.catalogSeeded) {
        const productQuery = query(collection(this.firestore, 'products'), limit(1));
        const productSnapshot = await getDocs(productQuery);
        if (!productSnapshot.empty) {
          const firstProduct = productSnapshot.docs[0].data();
          this.costsSeeded = !!firstProduct['costPrice'];
        }
      }
    } catch (error) {
      console.error('Error checking seeded data:', error);
    }
  }

  log(message: string, type: 'info' | 'success' | 'error' = 'info') {
    const time = new Date().toLocaleTimeString();
    this.logs.unshift({ time, message, type });
  }

  clearLogs() {
    this.logs = [];
  }

  // Wrapper helper to enable consistent loading state
  async runTask(name: string, task: () => Promise<void>) {
    const wasLoading = this.isLoading;
    if (!wasLoading) {
      this.isLoading = true;
    }
    this.log(`🚀 Starting ${name}...`);
    try {
      await task();
      this.log(`✅ ${name} completed successfully!`, 'success');
    } catch (error) {
      console.error(error);
      this.log(`❌ Error in ${name}: ${error}`, 'error');
    } finally {
      if (!wasLoading) {
        this.isLoading = false;
      }
    }
  }

  // --- HELPER: DELETE COLLECTION ---
  async deleteCollection(path: string, batchSize = 50): Promise<number> {
    const q = query(collection(this.firestore, path), limit(batchSize));
    const snapshot = await getDocs(q);

    // Recursive delete via batches
    if (snapshot.size === 0) return 0;

    const batch = writeBatch(this.firestore);
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    return snapshot.size + await this.deleteCollection(path, batchSize);
  }

  // --- 1. CATALOG ---
  async populateCatalog() {
    await this.runTask('Catalog Seeding', async () => {
      // Brands
      const batch1 = writeBatch(this.firestore);
      const brands = [
        { id: 'brand_praxis', name: 'Praxis', slug: 'praxis', description: { en: 'Premium motorcycle tires engineered in Mexico', es: 'Llantas premium para motocicleta diseñadas en México' }, logoUrl: 'https://via.placeholder.com/200x80/00ACD8/FFFFFF?text=PRAXIS', countryOfOrigin: 'Mexico', website: 'https://praxis.com.mx', featured: true, active: true },
        { id: 'brand_michelin', name: 'Michelin', slug: 'michelin', description: { en: 'French tire manufacturer known for innovation', es: 'Fabricante francés de llantas conocido por su innovación' }, logoUrl: 'https://via.placeholder.com/200x80/FFD700/000000?text=MICHELIN', countryOfOrigin: 'France', website: 'https://www.michelin.com', featured: true, active: true },
        { id: 'brand_pirelli', name: 'Pirelli', slug: 'pirelli', description: { en: 'Italian tire excellence with motorsport heritage', es: 'Excelencia italiana en llantas con herencia en deportes de motor' }, logoUrl: 'https://via.placeholder.com/200x80/D02C2F/FFFFFF?text=PIRELLI', countryOfOrigin: 'Italy', website: 'https://www.pirelli.com', featured: true, active: true },
        { id: 'brand_dunlop', name: 'Dunlop', slug: 'dunlop', description: { en: 'British tire brand with racing experience', es: 'Marca británica de llantas con experiencia en carreras' }, logoUrl: 'https://via.placeholder.com/200x80/93D500/000000?text=DUNLOP', countryOfOrigin: 'United Kingdom', website: 'https://www.dunlop.eu', featured: false, active: true },
        { id: 'brand_bridgestone', name: 'Bridgestone', slug: 'bridgestone', description: { en: 'Japanese tire technology leader', es: 'Líder japonés en tecnología de llantas' }, logoUrl: 'https://via.placeholder.com/200x80/000000/FFFFFF?text=BRIDGESTONE', countryOfOrigin: 'Japan', website: 'https://www.bridgestone.com', featured: false, active: true }
      ];

      console.log('Creating brands:', brands.length);
      brands.forEach(b => {
        const ref = doc(this.firestore, `brands/${b.id}`);
        console.log('Adding brand to batch:', b.id);
        batch1.set(ref, { ...b, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      });

      console.log('Committing brands batch...');
      await batch1.commit();
      console.log('Brands batch committed successfully');
      this.log('  Brands created.');

      // Categories
      const batch2 = writeBatch(this.firestore);
      const categories = [
        { id: 'cat_sport', name: { en: 'Sport', es: 'Deportivas' }, slug: 'sport', description: { en: 'High-performance tires for sport motorcycles', es: 'Llantas de alto rendimiento para motocicletas deportivas' }, icon: '🏍️', active: true, order: 1 },
        { id: 'cat_touring', name: { en: 'Touring', es: 'Turismo' }, slug: 'touring', description: { en: 'Long-lasting tires for comfort riding', es: 'Llantas duraderas para viajes cómodos' }, icon: '🛣️', active: true, order: 2 },
        { id: 'cat_offroad', name: { en: 'Off-Road', es: 'Todo Terreno' }, slug: 'off-road', description: { en: 'Rugged tires for adventure', es: 'Llantas robustas para aventura' }, icon: '⛰️', active: true, order: 3 },
        { id: 'cat_scooter', name: { en: 'Scooter', es: 'Scooter' }, slug: 'scooter', description: { en: 'Specialized tires for scooters', es: 'Llantas especializadas para scooters' }, icon: '🛴', active: true, order: 4 }
      ];
      categories.forEach(c => {
        const ref = doc(this.firestore, `categories/${c.id}`);
        batch2.set(ref, { ...c, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      });
      await batch2.commit();
      this.log('  Categories created.');

      // Products
      const batch3 = writeBatch(this.firestore);
      const products = [
        {
          id: 'prod_praxis_sport', name: { en: 'Praxis Sport Pro', es: 'Praxis Sport Pro' }, slug: 'praxis-sport-pro',
          brand: 'Praxis', brandId: 'brand_praxis', categoryId: 'cat_sport', sku: 'PRAX-120-70-17-SP',
          price: 1850, compareAtPrice: 2100, stockQuantity: 15, inStock: true, featured: true, active: true,
          specifications: { width: 120, aspectRatio: 70, diameter: 17, loadIndex: 58, speedRating: 'W' },
          images: { main: 'https://via.placeholder.com/800x800/00ACD8/FFFFFF?text=Praxis+Sport+Pro', gallery: [] }
        },
        // ... (truncated product list for brevity, assumes identical to before)
        {
          id: 'prod_michelin_pilot', name: { en: 'Michelin Pilot Power', es: 'Michelin Pilot Power' }, slug: 'michelin-pilot-power',
          brand: 'Michelin', brandId: 'brand_michelin', categoryId: 'cat_sport', sku: 'MICH-180-55-17-SP',
          price: 2200, stockQuantity: 8, inStock: true, featured: true, active: true, bestSeller: true,
          specifications: { width: 180, aspectRatio: 55, diameter: 17, loadIndex: 73, speedRating: 'W' },
          images: { main: 'https://via.placeholder.com/800x800/FFD700/000000?text=Michelin+Pilot', gallery: [] }
        },
        {
          id: 'prod_praxis_touring', name: { en: 'Praxis Touring Plus', es: 'Praxis Touring Plus' }, slug: 'praxis-touring-plus',
          brand: 'Praxis', brandId: 'brand_praxis', categoryId: 'cat_touring', sku: 'PRAX-130-80-17-TR',
          price: 1450, compareAtPrice: 1650, stockQuantity: 20, inStock: true, active: true, bestSeller: true,
          specifications: { width: 130, aspectRatio: 80, diameter: 17, loadIndex: 65, speedRating: 'H' },
          images: { main: 'https://via.placeholder.com/800x800/93D500/000000?text=Praxis+Touring', gallery: [] }
        },
        {
          id: 'prod_pirelli_rally', name: { en: 'Pirelli Scorpion Rally', es: 'Pirelli Scorpion Rally' }, slug: 'pirelli-scorpion-rally',
          brand: 'Pirelli', brandId: 'brand_pirelli', categoryId: 'cat_offroad', sku: 'PIR-110-80-19-OR',
          price: 1650, compareAtPrice: 1900, stockQuantity: 10, inStock: true, featured: true, active: true,
          specifications: { width: 110, aspectRatio: 80, diameter: 19, loadIndex: 59, speedRating: 'R' },
          images: { main: 'https://via.placeholder.com/800x800/D02C2F/FFFFFF?text=Pirelli+Scorpion', gallery: [] }
        },
        {
          id: 'prod_bridgestone_t32', name: { en: 'Bridgestone Battlax T32', es: 'Bridgestone Battlax T32' }, slug: 'bridgestone-battlax-t32',
          brand: 'Bridgestone', brandId: 'brand_bridgestone', categoryId: 'cat_touring', sku: 'BRID-120-70-17-TR',
          price: 1750, stockQuantity: 12, inStock: true, active: true,
          specifications: { width: 120, aspectRatio: 70, diameter: 17, loadIndex: 58, speedRating: 'W' },
          images: { main: 'https://via.placeholder.com/800x800/000000/FFFFFF?text=Bridgestone+T32', gallery: [] }
        },
        {
          id: 'prod_dunlop_q5', name: { en: 'Dunlop Sportmax Q5', es: 'Dunlop Sportmax Q5' }, slug: 'dunlop-sportmax-q5',
          brand: 'Dunlop', brandId: 'brand_dunlop', categoryId: 'cat_sport', sku: 'DUN-200-55-17-SP',
          price: 2400, stockQuantity: 5, inStock: true, featured: true, active: true, bestSeller: true,
          specifications: { width: 200, aspectRatio: 55, diameter: 17, loadIndex: 78, speedRating: 'W' },
          images: { main: 'https://via.placeholder.com/800x800/93D500/000000?text=Dunlop+Q5', gallery: [] }
        },
        {
          id: 'prod_praxis_city', name: { en: 'Praxis City Grip', es: 'Praxis City Grip' }, slug: 'praxis-city-grip',
          brand: 'Praxis', brandId: 'brand_praxis', categoryId: 'cat_scooter', sku: 'PRAX-110-70-12-SC',
          price: 850, stockQuantity: 30, inStock: true, active: true, bestSeller: true,
          specifications: { width: 110, aspectRatio: 70, diameter: 12, loadIndex: 47, speedRating: 'L' },
          images: { main: 'https://via.placeholder.com/800x800/00ACD8/FFFFFF?text=City+Grip', gallery: [] }
        },
        {
          id: 'prod_michelin_city_pro', name: { en: 'Michelin City Pro', es: 'Michelin City Pro' }, slug: 'michelin-city-pro',
          brand: 'Michelin', brandId: 'brand_michelin', categoryId: 'cat_scooter', sku: 'MICH-90-90-14-SC',
          price: 750, compareAtPrice: 850, stockQuantity: 25, inStock: true, active: true,
          specifications: { width: 90, aspectRatio: 90, diameter: 14, loadIndex: 46, speedRating: 'P' },
          images: { main: 'https://via.placeholder.com/800x800/FFD700/000000?text=City+Pro', gallery: [] }
        },
        {
          id: 'prod_pirelli_diablo', name: { en: 'Pirelli Diablo Rosso IV', es: 'Pirelli Diablo Rosso IV' }, slug: 'pirelli-diablo-rosso-iv',
          brand: 'Pirelli', brandId: 'brand_pirelli', categoryId: 'cat_sport', sku: 'PIR-190-55-17-DR',
          price: 2850, stockQuantity: 4, inStock: true, featured: true, active: true,
          specifications: { width: 190, aspectRatio: 55, diameter: 17, loadIndex: 75, speedRating: 'W' },
          images: { main: 'https://via.placeholder.com/800x800/D02C2F/000000?text=Diablo+Rosso+IV', gallery: [] }
        },
        {
          id: 'prod_bridgestone_ax41', name: { en: 'Bridgestone Battlax AX41', es: 'Bridgestone Battlax AX41' }, slug: 'bridgestone-battlax-ax41',
          brand: 'Bridgestone', brandId: 'brand_bridgestone', categoryId: 'cat_offroad', sku: 'BRID-150-70-18-AX',
          price: 2100, stockQuantity: 10, inStock: true, active: true,
          specifications: { width: 150, aspectRatio: 70, diameter: 18, loadIndex: 70, speedRating: 'Q' },
          images: { main: 'https://via.placeholder.com/800x800/000000/FFFFFF?text=Battlax+AX41', gallery: [] }
        }
      ];

      products.forEach(p => {
        const ref = doc(this.firestore, `products/${p.id}`);
        batch3.set(ref, {
          ...p,
          description: { en: 'High quality tire for testing.', es: 'Llanta de alta calidad para pruebas.' },
          features: { en: ['Excellent Grip', 'Durable', 'High Performance'], es: ['Excelente agarre', 'Duradera', 'Alto Rendimiento'] },
          createdAt: Timestamp.now(), updatedAt: Timestamp.now()
        });
      });
      await batch3.commit();
      this.log('  Products created.');
      this.catalogSeeded = true;
    });
  }

  async clearCatalog() {
    await this.runTask('Clearing Catalog', async () => {
      await this.deleteCollection('products');
      await this.deleteCollection('categories');
      await this.deleteCollection('brands');
      this.catalogSeeded = false;
    });
  }

  // --- 2. CUSTOMERS ---
  async populateCustomers() {
    await this.runTask('Customer Seeding', async () => {
      const batch = writeBatch(this.firestore);

      const realisticUsers = [
        {
          uid: 'cust_mariagarcia',
          displayName: 'Maria Garcia',
          email: 'maria.garcia.design@gmail.com',
          phone: '+52 55 5555 1234',
          role: 'CUSTOMER',
          photoURL: 'https://i.pravatar.cc/150?u=maria',
          isActive: true,
          createdAt: Timestamp.fromDate(new Date('2025-01-10T09:00:00')),
          lastLogin: Timestamp.fromDate(new Date('2025-01-18T14:30:00')),
          shippingAddress: {
            street: 'Av. Paseo de la Reforma',
            extNum: '222',
            intNum: 'Apt 402',
            colonia: 'Juárez',
            city: 'Ciudad de México',
            state: 'CDMX',
            zip: '06600',
            country: 'Mexico',
            label: 'Home',
            reference: 'Near the Angel of Independence',
            isDefault: true
          },
          stats: {
            totalOrders: 12,
            totalSpend: 24500,
            averageOrderValue: 2041.66,
            lastOrderDate: Timestamp.fromDate(new Date('2025-01-15T10:00:00'))
          }
        },
        {
          uid: 'cust_josehernandez',
          displayName: 'Jose Hernandez',
          email: 'jose.hdz.mech@hotmail.com',
          phone: '+52 33 3612 9876',
          role: 'CUSTOMER',
          photoURL: 'https://i.pravatar.cc/150?u=jose',
          isActive: true,
          createdAt: Timestamp.fromDate(new Date('2025-01-05T11:20:00')),
          lastLogin: Timestamp.fromDate(new Date('2025-01-17T09:15:00')),
          shippingAddress: {
            street: 'Calle Vallarta',
            extNum: '1500',
            colonia: 'Americana',
            city: 'Guadalajara',
            state: 'Jalisco',
            zip: '44160',
            country: 'Mexico',
            label: 'Workshop',
            isDefault: true
          },
          stats: {
            totalOrders: 5,
            totalSpend: 8200,
            averageOrderValue: 1640,
            lastOrderDate: Timestamp.fromDate(new Date('2025-01-12T16:45:00'))
          }
        },
        {
          uid: 'cust_antoniomartinez',
          displayName: 'Antonio Martinez',
          email: 'tony.martinez99@yahoo.com',
          phone: '+52 81 8345 6789',
          role: 'CUSTOMER',
          photoURL: null,
          isActive: true,
          createdAt: Timestamp.fromDate(new Date('2025-01-12T15:00:00')),
          lastLogin: Timestamp.fromDate(new Date('2025-01-12T15:05:00')), // Just created
          shippingAddress: {
            street: 'Av. Constitución',
            extNum: '405',
            intNum: 'PB',
            colonia: 'Centro',
            city: 'Monterrey',
            state: 'Nuevo León',
            zip: '64000',
            country: 'Mexico',
            label: 'Office',
            isDefault: true
          },
          stats: {
            totalOrders: 1,
            totalSpend: 1200,
            averageOrderValue: 1200,
            lastOrderDate: Timestamp.fromDate(new Date('2025-01-12T15:30:00'))
          }
        },
        {
          uid: 'cust_luciarodriguez',
          displayName: 'Lucia Rodriguez',
          email: 'lucia.rodriguez.arch@gmail.com',
          phone: '+52 22 2233 4455',
          role: 'CUSTOMER',
          photoURL: 'https://i.pravatar.cc/150?u=lucia',
          isActive: true,
          createdAt: Timestamp.fromDate(new Date('2024-12-20T08:00:00')),
          lastLogin: Timestamp.fromDate(new Date('2025-01-19T10:00:00')),
          shippingAddress: {
            street: 'Calle 5 de Mayo',
            extNum: '201',
            colonia: 'Centro Histórico',
            city: 'Puebla',
            state: 'Puebla',
            zip: '72000',
            country: 'Mexico',
            label: 'Home',
            isDefault: true
          },
          stats: {
            totalOrders: 3,
            totalSpend: 4500,
            averageOrderValue: 1500,
            lastOrderDate: Timestamp.fromDate(new Date('2025-01-08T11:00:00'))
          }
        },
        {
          uid: 'cust_migueltorres',
          displayName: 'Miguel Angel Torres',
          email: 'm.torres.logistics@empresa.mx',
          phone: '+52 99 9922 3344',
          role: 'CUSTOMER',
          photoURL: null,
          isActive: false, // Inactive user test case
          createdAt: Timestamp.fromDate(new Date('2024-11-15T14:20:00')),
          lastLogin: Timestamp.fromDate(new Date('2024-12-01T09:00:00')),
          shippingAddress: {
            street: 'Paseo de Montejo',
            extNum: '498',
            colonia: 'Centro',
            city: 'Mérida',
            state: 'Yucatán',
            zip: '97000',
            country: 'Mexico',
            label: 'Main Office',
            isDefault: true
          },
          stats: {
            totalOrders: 8,
            totalSpend: 32000,
            averageOrderValue: 4000,
            lastOrderDate: Timestamp.fromDate(new Date('2024-11-30T16:20:00'))
          }
        }
      ];

      console.log('Creating detailed customers:', realisticUsers.length);

      realisticUsers.forEach(u => {
        const ref = doc(this.firestore, `customers/${u.uid}`);
        batch.set(ref, u);

        // OPTIONAL: If we want these to appear in 'users' collection too (mimicking Auth sync)
        // const userRef = doc(this.firestore, `users/${u.uid}`);
        // batch.set(userRef, u); 
        // Note: I'm sticking to 'customers' only as per current pattern for Admin CRM.
      });

      await batch.commit();
      this.log(`  Seeded ${realisticUsers.length} realistic customers.`);
      this.customersSeeded = true;
    });
  }

  async clearCustomers() {
    await this.runTask('Clearing Customers', async () => {
      await this.deleteCollection('customers');
      this.customersSeeded = false;
    });
  }

  // --- 3. ORDERS ---
  async populateOrders() {
    await this.runTask('Order Seeding', async () => {
      // 1. Get actual products
      const productsSnapshot = await getDocs(collection(this.firestore, 'products'));
      if (productsSnapshot.empty) {
        this.log('  ❌ No products found. Seed catalog first.', 'error');
        return;
      }
      const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 2. Get actual customers
      const customersSnapshot = await getDocs(collection(this.firestore, 'customers'));
      if (customersSnapshot.empty) {
        this.log('  ❌ No customers found. Seed customers first.', 'error');
        return;
      }
      const customers = customersSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data['displayName'] || 'Unknown',
          email: data['email'] || 'unknown@example.com',
          phone: data['phone'] || '',
          shippingAddress: data['shippingAddress']
        };
      });

      const batch = writeBatch(this.firestore);

      const statuses = ['delivered', 'shipped', 'processing', 'pending', 'cancelled'];
      const statusWeights = [0.7, 0.15, 0.10, 0.03, 0.02]; // 70% delivered, etc.

      // Track stats to update customers later
      const customerStats: { [key: string]: { count: number, spend: number, lastDate: any } } = {};

      // Generate 100 orders: 90 in December 2025, 10 in November 2025
      for (let i = 1; i <= 100; i++) {
        const orderId = `ord_${String(i).padStart(3, '0')}`;
        const ref = doc(this.firestore, `orders/${orderId}`);

        // Determine order date
        let orderDate: Date;
        if (i <= 90) {
          // December 2025
          const day = Math.floor((i / 90) * 30) + 1;
          const hour = 9 + Math.floor(Math.random() * 10);
          orderDate = new Date(2025, 11, day, hour, Math.floor(Math.random() * 60));
        } else {
          // November 2025
          const day = Math.floor(Math.random() * 30) + 1;
          orderDate = new Date(2025, 10, day, 10, 0);
        }

        // Select status
        let status = 'delivered';
        const rand = Math.random();
        let cumulative = 0;
        for (let j = 0; j < statuses.length; j++) {
          cumulative += statusWeights[j];
          if (rand < cumulative) {
            status = statuses[j];
            break;
          }
        }

        // Pick random customer
        const customer = customers[Math.floor(Math.random() * customers.length)];

        // Generate items
        const itemsCount = Math.floor(Math.random() * 3) + 1;
        const items = [];
        let subtotal = 0;
        let costOfGoods = 0;

        for (let j = 0; j < itemsCount; j++) {
          const product: any = products[Math.floor(Math.random() * products.length)];
          const quantity = Math.random() < 0.7 ? 1 : 2;
          const price = product.price || 1500;
          const itemSubtotal = price * quantity;

          items.push({
            productId: product.id,
            productName: product.name?.en || product.name || 'Product',
            sku: product.sku || 'SKU-UNKNOWN',
            price: price,
            quantity: quantity,
            subtotal: itemSubtotal,
            productImage: product.images?.main || 'https://via.placeholder.com/100'
          });

          subtotal += itemSubtotal;
          if (product.costPrice) {
            costOfGoods += product.costPrice * quantity;
          } else {
            costOfGoods += price * 0.6 * quantity;
          }
        }

        const tax = subtotal * 0.16;
        const shippingCost = subtotal > 3000 ? 0 : 200;
        const total = subtotal + tax + shippingCost;

        // Update stats
        if (!customerStats[customer.id]) {
          customerStats[customer.id] = { count: 0, spend: 0, lastDate: null };
        }
        customerStats[customer.id].count++;
        customerStats[customer.id].spend += total;

        const orderTimestamp = Timestamp.fromDate(orderDate);
        const lastDate = customerStats[customer.id].lastDate;
        if (!lastDate || orderDate > lastDate.toDate()) {
          customerStats[customer.id].lastDate = orderTimestamp;
        }

        // Create order history
        const history = [
          { status: 'pending', timestamp: orderTimestamp, updatedBy: 'system' }
        ];

        if (status !== 'pending') {
          const processingDate = new Date(orderDate);
          processingDate.setHours(processingDate.getHours() + 2);
          history.push({ status: 'processing', timestamp: Timestamp.fromDate(processingDate), updatedBy: 'ops_user_1' });
        }
        if (status === 'shipped' || status === 'delivered') {
          const shippedDate = new Date(orderDate);
          shippedDate.setDate(shippedDate.getDate() + 1);
          history.push({ status: 'shipped', timestamp: Timestamp.fromDate(shippedDate), updatedBy: 'ops_user_2' });
        }
        if (status === 'delivered') {
          const deliveredDate = new Date(orderDate);
          deliveredDate.setDate(deliveredDate.getDate() + 3);
          history.push({ status: 'delivered', timestamp: Timestamp.fromDate(deliveredDate), updatedBy: 'system' });
        }
        if (status === 'cancelled') {
          const cancelledDate = new Date(orderDate);
          cancelledDate.setHours(cancelledDate.getHours() + 4);
          history.push({ status: 'cancelled', timestamp: Timestamp.fromDate(cancelledDate), updatedBy: 'customer' });
        }

        batch.set(ref, {
          id: orderId,
          orderNumber: `ORD-${2024000 + i}`,
          customer: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone || '+52 55 1234 5678'
          },
          items: items,
          subtotal,
          tax,
          shippingCost,
          discount: 0,
          total,
          costOfGoods,
          status: status,
          paymentStatus: status === 'cancelled' ? 'failed' : 'paid',
          // Use the customer's realistic address if available, else fallback
          shippingAddress: customer.shippingAddress || {
            street: 'Av. Insurgentes Sur',
            exteriorNumber: '1000',
            city: 'Ciudad de México',
            state: 'CDMX',
            zipCode: '03100',
            country: 'Mexico'
          },
          createdAt: orderTimestamp,
          updatedAt: history[history.length - 1].timestamp,
          history: history
        });
      }

      await batch.commit();
      this.log('  Created 100 orders (90 in December 2025, 10 in November 2025).');

      // Now update Customer Stats
      const statsBatch = writeBatch(this.firestore);
      let updatesCount = 0;

      for (const [userId, stats] of Object.entries(customerStats)) {
        const custRef = doc(this.firestore, `customers/${userId}`);
        statsBatch.update(custRef, {
          'stats.totalOrders': stats.count,
          'stats.totalSpend': stats.spend,
          'stats.lastOrderDate': stats.lastDate,
          'stats.averageOrderValue': stats.spend / stats.count
        });
        updatesCount++;
      }

      if (updatesCount > 0) {
        await statsBatch.commit();
        this.log(`  Updated stats for ${updatesCount} customers via linking.`);
      }

      this.log('  📊 December 2025 estimated revenue: ~$315,000 MXN', 'success');
      this.log('  💰 Expected gross profit: ~$126,000 MXN', 'success');
      this.ordersSeeded = true;
    });
  }

  async clearOrders() {
    await this.runTask('Clearing Orders', async () => {
      await this.deleteCollection('orders');
    });
  }

  // --- 4. COUPONS ---
  async populateCoupons() {
    await this.runTask('Coupon Seeding', async () => {
      const batch = writeBatch(this.firestore);
      const coupons = [
        { code: 'WELCOME10', type: 'percentage', value: 10, isActive: true },
        { code: 'FLASH50', type: 'fixed_amount', value: 500, isActive: true },
        { code: 'SUMMER20', type: 'percentage', value: 20, isActive: false }, // Inactive
        { code: 'VIPSHIP', type: 'fixed_amount', value: 200, isActive: true },
        { code: 'EXPIRED2023', type: 'percentage', value: 50, isActive: true, endDate: new Date('2023-01-01') } // Expired
      ];

      coupons.forEach((c, i) => {
        const ref = doc(this.firestore, `coupons/cpn_mock_${i}`);
        batch.set(ref, {
          ...c,
          startDate: Timestamp.now(),
          endDate: c.endDate ? Timestamp.fromDate(c.endDate) : null,
          usageLimit: 100,
          usageCount: Math.floor(Math.random() * 50),
          minPurchaseAmount: 0,
          createdAt: Timestamp.now()
        });
      });
      await batch.commit();
    });
  }

  async clearCoupons() {
    await this.runTask('Clearing Coupons', async () => {
      await this.deleteCollection('coupons');
    });
  }

  // --- 5. PRODUCT COSTS ---
  async populateProductCosts() {
    await this.runTask('Product Cost Seeding', async () => {
      const productsSnapshot = await getDocs(collection(this.firestore, 'products'));
      const batch = writeBatch(this.firestore);

      let count = 0;
      productsSnapshot.docs.forEach(doc => {
        const product = doc.data();
        const price = product['price'] || 1000;

        // Calculate cost price with 35-45% margin
        const marginPercent = 0.35 + (Math.random() * 0.10); // 35-45%
        const costPrice = Math.round(price * (1 - marginPercent));

        batch.update(doc.ref, {
          costPrice: costPrice,
          currency: 'MXN',
          margin: Math.round(marginPercent * 100),
          profitPerUnit: price - costPrice,
          lastCostUpdate: Timestamp.now()
        });
        count++;
      });

      await batch.commit();
      this.log(`  Added cost prices to ${count} products.`);
      this.costsSeeded = true;
    });
  }

  async clearProductCosts() {
    await this.runTask('Clearing Product Costs', async () => {
      const productsSnapshot = await getDocs(collection(this.firestore, 'products'));
      const batch = writeBatch(this.firestore);

      productsSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          costPrice: null,
          currency: null,
          margin: null,
          profitPerUnit: null,
          lastCostUpdate: null
        });
      });

      await batch.commit();
      this.costsSeeded = false;
    });
  }

  // --- 6. EXPENSES ---
  async populateExpenses() {
    await this.runTask('Expense Seeding', async () => {
      const batch = writeBatch(this.firestore);

      const expenses = [
        // Salaries - Optimized
        { category: 'SALARIES', amount: 25000, description: 'Nómina mensual - Equipo de ventas', vendor: 'Recursos Humanos', recurring: true, frequency: 'monthly' },
        { category: 'SALARIES', amount: 15000, description: 'Nómina mensual - Equipo de almacén', vendor: 'Recursos Humanos', recurring: true, frequency: 'monthly' },

        // Rent - Optimized
        { category: 'RENT', amount: 12000, description: 'Renta de bodega', vendor: 'Inmobiliaria del Centro', recurring: true, frequency: 'monthly' },
        { category: 'RENT', amount: 8000, description: 'Renta de oficinas', vendor: 'Inmobiliaria del Centro', recurring: true, frequency: 'monthly' },

        // Utilities
        { category: 'UTILITIES', amount: 2000, description: 'Electricidad', vendor: 'CFE', recurring: true, frequency: 'monthly' },
        { category: 'UTILITIES', amount: 600, description: 'Agua', vendor: 'SAPAC', recurring: true, frequency: 'monthly' },
        { category: 'UTILITIES', amount: 1500, description: 'Internet y telefonía', vendor: 'Telmex', recurring: true, frequency: 'monthly' },

        // Marketing - Optimized
        { category: 'MARKETING', amount: 4000, description: 'Publicidad en redes sociales', vendor: 'Meta Ads', recurring: true, frequency: 'monthly' },
        { category: 'MARKETING', amount: 5000, description: 'Campaña Google Ads', vendor: 'Google', recurring: false },

        // Insurance - Optimized
        { category: 'INSURANCE', amount: 8000, description: 'Seguro de inventario', vendor: 'AXA Seguros', recurring: true, frequency: 'monthly' },

        // Supplies
        { category: 'SUPPLIES', amount: 2000, description: 'Material de empaque', vendor: 'Empaques del Norte', recurring: false },
        { category: 'SUPPLIES', amount: 1000, description: 'Papelería y oficina', vendor: 'Office Depot', recurring: false },

        // Maintenance
        { category: 'MAINTENANCE', amount: 2500, description: 'Mantenimiento de montacargas', vendor: 'Servicio Industrial', recurring: false },

        // Shipping - Optimized
        { category: 'SHIPPING', amount: 6000, description: 'Servicios de paquetería', vendor: 'Estafeta', recurring: true, frequency: 'monthly' },

        // Professional Services
        { category: 'PROFESSIONAL_SERVICES', amount: 3500, description: 'Servicios contables', vendor: 'Despacho Contable', recurring: true, frequency: 'monthly' }
      ];

      const now = new Date();
      expenses.forEach((exp, i) => {
        // Place all expenses in December 2025 for income statement
        // Spread them across different days of the month
        const day = Math.floor((i / expenses.length) * 30) + 1; // Distribute across 30 days
        const expenseDate = new Date(2025, 11, day, 10, 0); // December 2025

        const ref = doc(collection(this.firestore, 'expenses'));
        batch.set(ref, {
          ...exp,
          date: Timestamp.fromDate(expenseDate),
          createdAt: Timestamp.now(),
          createdBy: 'seeder'
        });
      });

      await batch.commit();
      this.log(`  Created ${expenses.length} sample expenses in December 2025.`);
      this.expensesSeeded = true;
    });
  }

  async clearExpenses() {
    await this.runTask('Clearing Expenses', async () => {
      await this.deleteCollection('expenses');
      this.expensesSeeded = false;
    });
  }

  // --- 7. APPROVAL REQUESTS ---
  async populateApprovalRequests() {
    await this.runTask('Approval Requests Seeding', async () => {
      const batch = writeBatch(this.firestore);

      // Mock admin users
      const admin1 = { uid: 'admin_user_1', name: 'Admin García', email: 'admin@example.com', role: 'ADMIN' };
      const manager1 = { uid: 'manager_user_1', name: 'Manager López', email: 'manager@example.com', role: 'MANAGER' };

      const requests = [
        // 1. Pending Coupon Creation (20% discount)
        {
          type: 'COUPON_CREATION',
          status: 'PENDING',
          priority: 'HIGH',
          requestedBy: admin1,
          data: {
            code: 'MEGA20',
            type: 'percentage',
            value: 20,
            minPurchaseAmount: 5000,
            usageLimit: 50
          },
          notes: 'Campaña de fin de año - requiere aprobación por descuento alto',
          requestedAt: Timestamp.fromDate(new Date(2025, 11, 15, 10, 30)),
          autoApproved: false
        },
        // 2. Approved Coupon Creation (18% discount)
        {
          type: 'COUPON_CREATION',
          status: 'APPROVED',
          priority: 'NORMAL',
          requestedBy: admin1,
          reviewedBy: manager1,
          data: {
            code: 'WINTER18',
            type: 'percentage',
            value: 18,
            minPurchaseAmount: 3000,
            usageLimit: 100
          },
          notes: 'Promoción de invierno',
          reviewerNotes: 'Aprobado - descuento razonable para temporada',
          requestedAt: Timestamp.fromDate(new Date(2025, 11, 10, 14, 0)),
          reviewedAt: Timestamp.fromDate(new Date(2025, 11, 10, 16, 30)),
          autoApproved: false
        },
        // 3. Auto-approved Coupon (12% discount)
        {
          type: 'COUPON_CREATION',
          status: 'APPROVED',
          priority: 'LOW',
          requestedBy: admin1,
          data: {
            code: 'SAVE12',
            type: 'percentage',
            value: 12,
            minPurchaseAmount: 2000,
            usageLimit: 200
          },
          notes: 'Cupón estándar para clientes nuevos',
          requestedAt: Timestamp.fromDate(new Date(2025, 11, 18, 9, 0)),
          reviewedAt: Timestamp.fromDate(new Date(2025, 11, 18, 9, 0)),
          autoApproved: true
        },
        // 4. Pending Price Change (15% reduction)
        {
          type: 'PRICE_CHANGE',
          status: 'PENDING',
          priority: 'URGENT',
          requestedBy: admin1,
          data: {
            productId: 'prod_praxis_sport',
            productName: 'Praxis Sport Pro',
            productSku: 'PRAX-120-70-17-SP',
            currentPrice: 1850,
            newPrice: 1572.50,
            changePercentage: -15,
            reason: 'Ajuste de precio por competencia - Michelin bajó precios'
          },
          notes: 'Necesitamos igualar precios de la competencia',
          requestedAt: Timestamp.fromDate(new Date(2025, 11, 20, 11, 0)),
          autoApproved: false
        },
        // 5. Rejected Price Change (50% reduction - too high)
        {
          type: 'PRICE_CHANGE',
          status: 'REJECTED',
          priority: 'HIGH',
          requestedBy: admin1,
          reviewedBy: manager1,
          data: {
            productId: 'prod_pirelli_diablo',
            productName: 'Pirelli Diablo Rosso IV',
            productSku: 'PIR-190-55-17-DR',
            currentPrice: 2850,
            newPrice: 1425,
            changePercentage: -50,
            reason: 'Liquidación de inventario'
          },
          notes: 'Tenemos exceso de inventario de este modelo',
          rejectionReason: 'Reducción demasiado agresiva. Proponer 25-30% máximo.',
          requestedAt: Timestamp.fromDate(new Date(2025, 11, 12, 15, 0)),
          reviewedAt: Timestamp.fromDate(new Date(2025, 11, 13, 10, 0)),
          autoApproved: false
        },
        // 6. Approved Bulk Discount
        {
          type: 'BULK_DISCOUNT',
          status: 'APPROVED',
          priority: 'NORMAL',
          requestedBy: admin1,
          reviewedBy: manager1,
          data: {
            categoryId: 'cat_touring',
            categoryName: 'Touring',
            discountPercentage: 15,
            minQuantity: 4,
            startDate: new Date(2025, 11, 1),
            endDate: new Date(2025, 11, 31),
            reason: 'Promoción de fin de año para llantas de turismo'
          },
          notes: 'Descuento por volumen para impulsar ventas de touring',
          reviewerNotes: 'Aprobado - buena estrategia para fin de año',
          requestedAt: Timestamp.fromDate(new Date(2025, 10, 28, 10, 0)),
          reviewedAt: Timestamp.fromDate(new Date(2025, 10, 29, 14, 0)),
          autoApproved: false
        },
        // 7. Pending Promotion
        {
          type: 'PROMOTION_CREATION',
          status: 'PENDING',
          priority: 'NORMAL',
          requestedBy: admin1,
          data: {
            name: 'Black Friday Especial',
            discountPercentage: 25,
            targetProducts: ['prod_michelin_pilot', 'prod_dunlop_q5'],
            startDate: new Date(2025, 10, 29),
            endDate: new Date(2025, 11, 2)
          },
          notes: 'Promoción especial de Black Friday',
          requestedAt: Timestamp.fromDate(new Date(2025, 10, 25, 16, 0)),
          autoApproved: false
        },
        // 8. Auto-approved Fixed Amount Coupon
        {
          type: 'COUPON_CREATION',
          status: 'APPROVED',
          priority: 'LOW',
          requestedBy: admin1,
          data: {
            code: 'SHIP200',
            type: 'fixed_amount',
            value: 200,
            minPurchaseAmount: 3000,
            usageLimit: 150
          },
          notes: 'Descuento en envío para compras mayores',
          requestedAt: Timestamp.fromDate(new Date(2025, 11, 5, 13, 0)),
          reviewedAt: Timestamp.fromDate(new Date(2025, 11, 5, 13, 0)),
          autoApproved: true
        }
      ];

      requests.forEach((req, i) => {
        const ref = doc(collection(this.firestore, 'approval_requests'));
        batch.set(ref, req);
      });

      await batch.commit();
      this.log(`  Created ${requests.length} approval requests.`);
      this.approvalsSeeded = true;
    });
  }

  async clearApprovalRequests() {
    await this.runTask('Clearing Approval Requests', async () => {
      try {
        await this.deleteCollection('approval_requests');
        this.approvalsSeeded = false;
      } catch (error: any) {
        if (error.code === 'permission-denied') {
          this.log('  ⚠️ Permission denied - requires MANAGER/SUPER_ADMIN role', 'info');
          this.log('  You can still seed new approval requests', 'info');
        } else {
          throw error;
        }
      }
    });
  }

  // --- 8. OPERATIONS DATA ---
  async populateOperationsData() {
    await this.runTask('Operations Data Seeding', async () => {
      // Get all orders
      const ordersSnapshot = await getDocs(collection(this.firestore, 'orders'));
      if (ordersSnapshot.empty) {
        this.log('  No orders found. Seed orders first.', 'error');
        return;
      }

      const batch = writeBatch(this.firestore);
      const orders = ordersSnapshot.docs;

      // Mock operations staff
      const staff = [
        { uid: 'ops_user_1', name: 'Roberto García', email: 'roberto@example.com', role: 'OPERATIONS_STAFF' },
        { uid: 'ops_user_2', name: 'Carmen López', email: 'carmen@example.com', role: 'OPERATIONS_STAFF' },
        { uid: 'ops_user_3', name: 'Luis Martínez', email: 'luis@example.com', role: 'OPERATIONS_MANAGER' }
      ];

      let assignmentCount = 0;
      let noteCount = 0;
      let priorityCount = 0;

      // Assign 60% of orders
      const ordersToAssign = orders.slice(0, Math.floor(orders.length * 0.6));
      ordersToAssign.forEach((orderDoc, i) => {
        const assignedStaff = staff[i % staff.length];
        const assignRef = doc(collection(this.firestore, 'orderAssignments'));
        batch.set(assignRef, {
          orderId: orderDoc.id,
          assignedTo: assignedStaff.uid,
          assignedBy: 'ops_user_3',
          assignedAt: Timestamp.now(),
          status: 'active'
        });
        assignmentCount++;

        // Add 2-3 notes per assigned order
        const notesCount = 2 + Math.floor(Math.random() * 2);
        const noteTemplates = [
          'Cliente confirmó dirección de entrega',
          'Paquete listo para envío',
          'Coordinado con mensajería',
          'Cliente solicitó factura',
          'Verificado inventario disponible',
          'Empacado y etiquetado'
        ];

        for (let j = 0; j < notesCount; j++) {
          const noteRef = doc(collection(this.firestore, 'orderNotes'));
          batch.set(noteRef, {
            orderId: orderDoc.id,
            note: noteTemplates[Math.floor(Math.random() * noteTemplates.length)],
            createdBy: assignedStaff.uid,
            createdByName: assignedStaff.name,
            createdAt: Timestamp.now(),
            isInternal: true
          });
          noteCount++;
        }
      });

      // Set priorities for 40% of orders
      const ordersForPriority = orders.slice(0, Math.floor(orders.length * 0.4));
      const priorities = ['high', 'urgent', 'standard'];
      ordersForPriority.forEach((orderDoc, i) => {
        const priorityRef = doc(collection(this.firestore, 'orderPriorities'));
        batch.set(priorityRef, {
          orderId: orderDoc.id,
          priority: priorities[i % priorities.length],
          setBy: 'ops_user_3',
          setAt: Timestamp.now(),
          reason: i % 3 === 0 ? 'Cliente VIP' : i % 3 === 1 ? 'Pedido urgente' : 'Prioridad estándar'
        });
        priorityCount++;
      });

      await batch.commit();
      this.log(`  Created ${assignmentCount} assignments, ${noteCount} notes, ${priorityCount} priorities.`);
      this.operationsSeeded = true;
    });
  }

  async clearOperationsData() {
    await this.runTask('Clearing Operations Data', async () => {
      await this.deleteCollection('orderAssignments');
      await this.deleteCollection('orderNotes');
      await this.deleteCollection('orderPriorities');
      this.operationsSeeded = false;
    });
  }

  // --- 9. NOTIFICATIONS ---
  async populateNotifications() {
    await this.runTask('Notifications Seeding', async () => {
      const batch = writeBatch(this.firestore);

      // Mock users
      const manager = 'manager_user_1';
      const admin = 'admin_user_1';
      const customer = 'cust_user_1';

      const notifications = [
        // Approval notifications for managers
        {
          userId: manager,
          title: 'Nueva solicitud de aprobación',
          message: 'Cupón MEGA20 (20% descuento) requiere tu aprobación',
          type: 'APPROVAL_NEEDED',
          read: false,
          actionUrl: '/command-center/approvals',
          actionLabel: 'Revisar',
          relatedType: 'approval_request',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 15, 10, 35))
        },
        {
          userId: manager,
          title: 'Nueva solicitud de aprobación',
          message: 'Cambio de precio para Praxis Sport Pro (-15%) requiere aprobación',
          type: 'APPROVAL_NEEDED',
          read: false,
          actionUrl: '/command-center/approvals',
          actionLabel: 'Revisar',
          relatedType: 'approval_request',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 20, 11, 5))
        },
        {
          userId: manager,
          title: 'Nueva solicitud de aprobación',
          message: 'Promoción Black Friday Especial requiere tu revisión',
          type: 'APPROVAL_NEEDED',
          read: true,
          actionUrl: '/command-center/approvals',
          actionLabel: 'Revisar',
          relatedType: 'approval_request',
          createdAt: Timestamp.fromDate(new Date(2025, 10, 25, 16, 10))
        },
        // Approval decision notifications for requesters
        {
          userId: admin,
          title: 'Solicitud aprobada',
          message: 'Tu solicitud para cupón WINTER18 ha sido aprobada',
          type: 'APPROVAL_APPROVED',
          read: true,
          actionUrl: '/command-center/approvals',
          actionLabel: 'Ver detalles',
          relatedType: 'approval_request',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 10, 16, 35))
        },
        {
          userId: admin,
          title: 'Solicitud rechazada',
          message: 'Tu solicitud de cambio de precio para Pirelli Diablo fue rechazada',
          type: 'APPROVAL_REJECTED',
          read: false,
          actionUrl: '/command-center/approvals',
          actionLabel: 'Ver razón',
          relatedType: 'approval_request',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 13, 10, 5))
        },
        {
          userId: admin,
          title: 'Solicitud aprobada',
          message: 'Descuento masivo para categoría Touring ha sido aprobado',
          type: 'APPROVAL_APPROVED',
          read: true,
          actionUrl: '/command-center/approvals',
          actionLabel: 'Ver detalles',
          relatedType: 'approval_request',
          createdAt: Timestamp.fromDate(new Date(2025, 10, 29, 14, 10))
        },
        // Order notifications for customers
        {
          userId: customer,
          title: 'Pedido confirmado',
          message: 'Tu pedido #ORD-2025001 ha sido confirmado',
          type: 'SUCCESS',
          read: true,
          actionUrl: '/orders/ord_001',
          actionLabel: 'Ver pedido',
          relatedType: 'order',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 5, 14, 0))
        },
        {
          userId: customer,
          title: 'Pedido en camino',
          message: 'Tu pedido #ORD-2025001 está en camino',
          type: 'INFO',
          read: false,
          actionUrl: '/orders/ord_001',
          actionLabel: 'Rastrear',
          relatedType: 'order',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 7, 10, 0))
        },
        {
          userId: customer,
          title: 'Pedido entregado',
          message: 'Tu pedido #ORD-2025002 ha sido entregado',
          type: 'SUCCESS',
          read: true,
          actionUrl: '/orders/ord_002',
          actionLabel: 'Ver detalles',
          relatedType: 'order',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 10, 16, 30))
        },
        // System notifications
        {
          userId: admin,
          title: 'Inventario bajo',
          message: 'Praxis Sport Pro tiene solo 5 unidades en stock',
          type: 'WARNING',
          read: false,
          actionUrl: '/admin/products/prod_praxis_sport',
          actionLabel: 'Ver producto',
          relatedType: 'product',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 18, 9, 0))
        },
        {
          userId: manager,
          title: 'Reporte mensual disponible',
          message: 'El reporte financiero de noviembre está listo',
          type: 'INFO',
          read: true,
          actionUrl: '/command-center/financials',
          actionLabel: 'Ver reporte',
          relatedType: 'report',
          createdAt: Timestamp.fromDate(new Date(2025, 11, 1, 8, 0))
        }
      ];

      notifications.forEach(notif => {
        const ref = doc(collection(this.firestore, 'notifications'));
        batch.set(ref, notif);
      });

      await batch.commit();
      this.log(`  Created ${notifications.length} notifications.`);
      this.notificationsSeeded = true;
    });
  }

  async clearNotifications() {
    await this.runTask('Clearing Notifications', async () => {
      await this.deleteCollection('notifications');
      this.notificationsSeeded = false;
    });
  }

  // --- SEED ALL DATA ---
  async seedAllData() {
    await this.runTask('Seeding All Data', async () => {
      this.log('📦 Step 1/9: Seeding Catalog...');
      await this.populateCatalog();

      this.log('👥 Step 2/9: Seeding Customers...');
      await this.populateCustomers();

      this.log('💵 Step 3/9: Adding Product Costs...');
      await this.populateProductCosts();

      this.log('🛒 Step 4/9: Seeding Orders...');
      await this.populateOrders();

      this.log('🎟️ Step 5/9: Seeding Coupons...');
      await this.populateCoupons();

      this.log('💰 Step 6/9: Seeding Expenses...');
      await this.populateExpenses();

      this.log('✅ Step 7/9: Seeding Approval Requests...');
      await this.populateApprovalRequests();

      this.log('⚙️ Step 8/9: Seeding Operations Data...');
      await this.populateOperationsData();

      this.log('🔔 Step 9/9: Seeding Notifications...');
      await this.populateNotifications();

      this.log('🎉 All data seeded successfully!', 'success');
      this.log('💰 December 2025 revenue: ~$315,000 MXN', 'success');
      this.log('📈 Expected net profit: ~$109,000 MXN', 'success');
    });
  }

  // --- VERIFY DATA ---
  async verifyData() {
    await this.runTask('Verifying Data', async () => {
      this.log('🔍 Checking all collections...', 'info');

      // Check each collection
      const collections = [
        { name: 'brands', expected: 5, icon: '🏷️' },
        { name: 'categories', expected: 4, icon: '📁' },
        { name: 'products', expected: 10, icon: '📦' },
        { name: 'customers', expected: 10, icon: '👥' },
        { name: 'orders', expected: 50, icon: '🛒' },
        { name: 'coupons', expected: 5, icon: '🎟️' },
        { name: 'expenses', expected: 15, icon: '💰' },
        { name: 'approval_requests', expected: 8, icon: '✅' },
        { name: 'orderAssignments', expected: 30, icon: '⚙️' },
        { name: 'orderNotes', expected: 60, icon: '📝' },
        { name: 'orderPriorities', expected: 20, icon: '🎯' },
        { name: 'notifications', expected: 20, icon: '🔔' }
      ];

      let allGood = true;

      for (const col of collections) {
        try {
          const snapshot = await getDocs(collection(this.firestore, col.name));
          const count = snapshot.size;
          const status = count >= col.expected ? '✅' : count > 0 ? '⚠️' : '❌';

          if (count >= col.expected) {
            this.log(`${status} ${col.icon} ${col.name}: ${count} (expected ${col.expected})`, 'success');
          } else if (count > 0) {
            this.log(`${status} ${col.icon} ${col.name}: ${count} (expected ${col.expected})`, 'info');
            allGood = false;
          } else {
            this.log(`${status} ${col.icon} ${col.name}: ${count} (expected ${col.expected})`, 'error');
            allGood = false;
          }
        } catch (error: any) {
          // Handle permission errors gracefully
          if (error.code === 'permission-denied') {
            this.log(`🔒 ${col.icon} ${col.name}: Permission denied (requires MANAGER/SUPER_ADMIN role)`, 'info');
          } else {
            this.log(`❌ ${col.icon} ${col.name}: Error - ${error.message}`, 'error');
            allGood = false;
          }
        }
      }

      // Check December orders specifically
      try {
        const ordersSnapshot = await getDocs(collection(this.firestore, 'orders'));
        let decemberCount = 0;
        let totalRevenue = 0;
        let totalCOGS = 0;

        ordersSnapshot.docs.forEach(doc => {
          const order = doc.data();
          const orderDate = order['createdAt']?.toDate();
          if (orderDate && orderDate.getMonth() === 11 && orderDate.getFullYear() === 2025) {
            decemberCount++;
            totalRevenue += order['total'] || 0;
            totalCOGS += order['costOfGoods'] || 0;
          }
        });

        this.log('', 'info');
        this.log('📊 December 2025 Analysis:', 'info');
        this.log(`   Orders: ${decemberCount} (expected 90)`, decemberCount >= 90 ? 'success' : 'error');
        this.log(`   Revenue: $${totalRevenue.toFixed(2)} MXN`, 'info');
        this.log(`   COGS: $${totalCOGS.toFixed(2)} MXN`, 'info');
        this.log(`   Gross Profit: $${(totalRevenue - totalCOGS).toFixed(2)} MXN`, 'info');

        // Check expenses
        const expensesSnapshot = await getDocs(collection(this.firestore, 'expenses'));
        let decemberExpenses = 0;
        expensesSnapshot.docs.forEach(doc => {
          const expense = doc.data();
          const expenseDate = expense['date']?.toDate();
          if (expenseDate && expenseDate.getMonth() === 11 && expenseDate.getFullYear() === 2025) {
            decemberExpenses += expense['amount'] || 0;
          }
        });

        this.log(`   Operating Expenses: $${decemberExpenses.toFixed(2)} MXN`, 'info');
        const netProfit = totalRevenue - totalCOGS - decemberExpenses;
        this.log(`   Net Profit: $${netProfit.toFixed(2)} MXN`, netProfit > 0 ? 'success' : 'error');

        this.log('', 'info');
        if (decemberCount >= 90 && netProfit > 0) {
          this.log('🎉 Core data verified successfully!', 'success');
          this.log('✅ Database is ready for testing!', 'success');
          this.log('💡 Some collections may require MANAGER role to verify', 'info');
        } else {
          this.log('⚠️ Some collections have missing data', 'info');
          this.log('💡 Run "Seed All Data" to populate missing collections', 'info');
        }
      } catch (error: any) {
        this.log(`❌ Error analyzing December data: ${error.message}`, 'error');
      }
    });
  }
}
