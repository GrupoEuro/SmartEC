import { Injectable, computed, signal, inject } from '@angular/core';
import { Firestore, collection, getDocs, query, where, doc, updateDoc } from '@angular/fire/firestore';
import { SettingsService } from '../../../core/services/settings.service';
import { firstValueFrom } from 'rxjs';

export interface ChannelListing {
  id: string;
  channel_id: string;
  listing_type: string;
  commission_percentage: number;
  fixed_fees: number;
  shipping_profile: number;
  current_list_price: number;
  calculated_floor_price: number;
}

export interface MasterSku {
  id: string;
  sku: string;
  title: string;
  base_cost: number;
  minimum_margin_multiplier: number;
  manual_shipping_cost: number | null;
  is_bundle?: boolean;
  components?: { sku: string; qty: number; cost_snapshot: number }[];
  listings: ChannelListing[];
}

@Injectable({
  providedIn: 'root'
})
export class PricingSignalContext {
  private firestore = inject(Firestore);
  private settingsService = inject(SettingsService);

  // State
  public masterSkus = signal<MasterSku[]>([]);
  public isLoading = signal<boolean>(false);

  // Simulation State (Global variable adjustments)
  public simulationCommissionBump = signal<number>(0);
  public simulationShippingBump = signal<number>(0);

  // Computed state for Anomalies
  public anomalies = computed(() => {
    const allListings = this.masterSkus().flatMap(sku => sku.listings);
    return allListings.filter(listing => listing.current_list_price < listing.calculated_floor_price);
  });

  public async loadInitialData() {
    this.isLoading.set(true);
    try {
      // Ensure settings are loaded
      await this.settingsService.loadSettings();

      // 1. Fetch Data in Parallel
      const [productsSnap, strategiesSnap, globalSettings] = await Promise.all([
        getDocs(query(collection(this.firestore, 'products'), where('active', '==', true))),
        getDocs(collection(this.firestore, 'pricing_strategies')),
        firstValueFrom(this.settingsService.settings$)
      ]);

      const globalDefaults = globalSettings?.pricing?.globalDefaults || {
          targetNetMargin: 20, minAcceptableMargin: 12,
          webShipping: 150, webCcFeePercent: 3.6, webMaxDiscountPercent: 10,
          meliCommissionPercent: 15, meliShipping: 200, meliFixedFee: 25,
          amazonReferralPercent: 15, amazonFbaFee: 180
      };

      const stratMap = new Map<string, any>();
      strategiesSnap.forEach(doc => {
          const data = doc.data() as any;
          if (data.sku) {
              stratMap.set(String(data.sku).trim().toUpperCase(), data);
          }
      });

      const masterMap = new Map<string, MasterSku>();

      productsSnap.forEach(doc => {
        const p = doc.data() as any;
        const rawSku = p.sku || doc.id;
        const sku = String(rawSku).trim().toUpperCase();
        
        const strat = stratMap.get(sku);

        const cog = strat?.cog ?? p.costPrice ?? p.cog ?? p.averageCost ?? 0;
        const inbound = strat?.inboundShipping ?? 0;
        const storageCost = strat?.storageCost ?? 0;
        const packaging = strat?.packagingCost ?? 0;
        const baseCost = cog + inbound + storageCost + packaging;

        const master: MasterSku = {
          id: doc.id,
          sku: String(rawSku),
          title: p.name?.es || p.title || String(rawSku),
          base_cost: baseCost,
          minimum_margin_multiplier: (strat?.minAcceptableMargin ?? globalDefaults.minAcceptableMargin), // Now holds the minimum acceptable margin (e.g. 12)
          manual_shipping_cost: null,
          listings: []
        };

        // Add Web Listing implicitly
        if (p.price > 0 && baseCost > 0) {
           const webShipping = strat?.webShipping ?? globalDefaults.webShipping;
           const webCcFeePercent = strat?.webCcFeePercent ?? globalDefaults.webCcFeePercent;
           const webMaxDiscountPercent = strat?.webMaxDiscountPercent ?? globalDefaults.webMaxDiscountPercent;
           const minMargin = master.minimum_margin_multiplier;

           const safeDiv = (num: number, den: number) => den <= 0 ? 0 : num / den;
           
           // Floor Price = (COGs + Shipping + FixedFees) / (1 - (MinAcceptableMargin / 100) - (CommissionPercent / 100))
           const floor = safeDiv(
               (baseCost + webShipping),
               (1 - (minMargin / 100) - (webCcFeePercent / 100) - (webMaxDiscountPercent / 100))
           );

           master.listings.push({
             id: `web-${doc.id}`,
             channel_id: 'Tienda Web',
             listing_type: 'Web',
             commission_percentage: webCcFeePercent / 100, // e.g. Payment Gateway
             fixed_fees: webShipping,
             shipping_profile: 0,
             current_list_price: p.price,
             calculated_floor_price: floor
           });
        }
        
        masterMap.set(sku, master);
      });

      // 1.5 Fetch Bundles / Kits (Virtual Products)
      // Combos rely on component base_costs to dynamically calculate their true cost.
      let bundlesSnap: any = { empty: true };
      try {
        bundlesSnap = await getDocs(collection(this.firestore, 'bundles'));
        bundlesSnap.forEach((doc: any) => {
          const b = doc.data() as any;
          const rawSku = b.bundle_sku || doc.id;
          const sku = String(rawSku).trim().toUpperCase();
          
          let totalCost = 0;
          const componentsInfo: { sku: string; qty: number; cost_snapshot: number }[] = [];
          
          if (Array.isArray(b.components)) {
            b.components.forEach((comp: any) => {
              const compSku = String(comp.sku).trim().toUpperCase();
              const qty = Number(comp.qty) || 1;
              const refProduct = masterMap.get(compSku);
              const compCost = refProduct ? refProduct.base_cost : 0;
              
              totalCost += (compCost * qty);
              componentsInfo.push({ sku: compSku, qty, cost_snapshot: compCost });
            });
          }
          
          const master: MasterSku = {
            id: doc.id,
            sku: String(rawSku),
            title: b.title || b.name?.es || `Bundle: ${rawSku}`,
            base_cost: totalCost,
            minimum_margin_multiplier: 1.2,
            manual_shipping_cost: b.shipping_profile || null,
            is_bundle: true,
            components: componentsInfo,
            listings: []
          };
          
          masterMap.set(sku, master);
        });
      } catch (e) {
        console.warn('[PricingEngine] Bundles collection not accessible or empty:', e);
      }

      // MOCK BUNDLE FOR TESTING (if no real bundles exist)
      if (bundlesSnap.empty) {
        masterMap.set('COMBO-MOTO-TEST', {
          id: 'COMBO-MOTO-TEST',
          sku: 'COMBO-MOTO-TEST',
          title: 'Kit 2 Llantas Praxis (110/70 + 120/80)',
          base_cost: 550, // 250 + 300
          minimum_margin_multiplier: 1.2,
          manual_shipping_cost: 150,
          is_bundle: true,
          components: [
            { sku: '110/70-17-EY-030-TL', qty: 1, cost_snapshot: 250 },
            { sku: '120/80-17-EY-198-TL', qty: 1, cost_snapshot: 300 }
          ],
          listings: [{
            id: 'MLM-TEST-COMBO',
            channel_id: 'Mercado Libre',
            listing_type: 'Full',
            commission_percentage: 0.15,
            fixed_fees: 0,
            shipping_profile: 150,
            current_list_price: 1499,
            calculated_floor_price: 810 // (550 * 1.2) + 150
          }]
        });
      }

      // 2. Fetch MeLi Listings
      const meliSnap = await getDocs(collection(this.firestore, 'meli_listings'));
      
      meliSnap.forEach(docSnapshot => {
        const m = docSnapshot.data() as any;
        let sku: string;

        if (m.mapped_bundle && Array.isArray(m.mapped_bundle) && m.mapped_bundle.length > 0) {
            const rawSku = m.seller_custom_field || m.sku || `UNKNOWN-${docSnapshot.id}`;
            sku = `BNDL-${docSnapshot.id}`;
            
            if (!masterMap.has(sku)) {
                let totalCost = 0;
                const componentsInfo: { sku: string; qty: number; cost_snapshot: number }[] = [];
                
                m.mapped_bundle.forEach((comp: any) => {
                    const compSku = String(comp.sku).trim().toUpperCase();
                    const qty = Number(comp.qty) || 1;
                    const refProduct = masterMap.get(compSku);
                    const compCost = refProduct ? refProduct.base_cost : 0;
                    totalCost += (compCost * qty);
                    componentsInfo.push({ sku: compSku, qty, cost_snapshot: compCost });
                });

                masterMap.set(sku, {
                    id: sku,
                    sku: sku,
                    title: m.title || `Custom Kit: ${rawSku}`,
                    base_cost: totalCost,
                    minimum_margin_multiplier: globalDefaults.minAcceptableMargin,
                    manual_shipping_cost: null,
                    is_bundle: true,
                    components: componentsInfo,
                    listings: []
                });
            }
        } else {
            const rawSku = m.mapped_sku || m.seller_custom_field || m.sku || `UNKNOWN-${docSnapshot.id}`;
            sku = String(rawSku).trim().toUpperCase();
            
            // If we don't have a Web Product for this SKU, create a placeholder Master SKU
            if (!masterMap.has(sku)) {
                const strat = stratMap.get(sku);
                const baseCost = strat?.cog ?? 0;
                masterMap.set(sku, {
                    id: `orphan-${docSnapshot.id}`,
                    sku: String(rawSku),
                    title: m.title || `Orphan SKU: ${rawSku}`,
                    base_cost: baseCost, // Unknown cost
                    minimum_margin_multiplier: strat?.minAcceptableMargin ?? globalDefaults.minAcceptableMargin,
                    manual_shipping_cost: null,
                    listings: []
                });
            }
        }

        const master = masterMap.get(sku)!;
        const strat = stratMap.get(sku);
        const isFull = m.logistic_type === 'fulfillment' || m.is_full;
        const price = m.price || 0;
        const net = m.net_amount || 0;
        const fee = m.selling_fee_amount || 0;
        
        // Shipping = Price - Fee - Net
        let calculatedShipping = price - fee - net;
        if (calculatedShipping < 0) calculatedShipping = 0;

        const commissionPct = price > 0 ? (fee / price) : (strat?.meliCommissionPercent ? (strat.meliCommissionPercent/100) : (globalDefaults.meliCommissionPercent/100));
        
        const minMargin = master.minimum_margin_multiplier;
        const safeDiv = (num: number, den: number) => den <= 0 ? 0 : num / den;

        // Floor Price Algebra
        const floor = safeDiv(
               (master.base_cost + calculatedShipping + (strat?.meliFixedFee ?? globalDefaults.meliFixedFee)),
               (1 - (minMargin / 100) - commissionPct)
        );

        master.listings.push({
          id: docSnapshot.id,
          channel_id: 'Mercado Libre',
          listing_type: isFull ? 'Full' : 'Classic',
          commission_percentage: commissionPct,
          fixed_fees: strat?.meliFixedFee ?? globalDefaults.meliFixedFee,
          shipping_profile: calculatedShipping,
          current_list_price: price,
          calculated_floor_price: floor
        });
      });

      this.masterSkus.set(Array.from(masterMap.values()));
    } catch (e) {
      console.error('[PricingEngine] Failed to load live data:', e);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Maps an orphan Mercado Libre listing to a Master SKU in the catalog.
   */
  public async mapListingToSku(listingId: string, targetSku: string) {
    try {
      this.isLoading.set(true);
      const listingRef = doc(this.firestore, 'meli_listings', listingId);
      // We explicitly clear mapped_bundle if setting a single SKU
      await updateDoc(listingRef, { mapped_sku: targetSku, mapped_bundle: null });
      console.log(`[PricingEngine] Mapped listing ${listingId} to SKU ${targetSku}`);
      
      // Reload data to reflect changes
      await this.loadInitialData();
    } catch (e) {
      console.error('[PricingEngine] Failed to map listing:', e);
      this.isLoading.set(false);
      throw e;
    }
  }

  /**
   * Maps an orphan Mercado Libre listing to a custom bundle/kit of Master SKUs.
   */
  public async mapListingToBundle(listingId: string, components: {sku: string, qty: number}[]) {
    try {
      this.isLoading.set(true);
      const listingRef = doc(this.firestore, 'meli_listings', listingId);
      // We explicitly clear mapped_sku if setting a bundle
      await updateDoc(listingRef, { mapped_bundle: components, mapped_sku: null });
      console.log(`[PricingEngine] Mapped listing ${listingId} to Custom Bundle`);
      
      // Reload data to reflect changes
      await this.loadInitialData();
    } catch (e) {
      console.error('[PricingEngine] Failed to map listing to bundle:', e);
      this.isLoading.set(false);
      throw e;
    }
  }
}
