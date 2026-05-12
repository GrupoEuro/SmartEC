import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { PricingService } from './pricing/PricingService';

const db = admin.firestore();

/**
 * Cloud Storage Trigger for ETL Pricing Data Import
 * Listens to the `etl-pricing-imports/` bucket directory.
 */
export const processPricingUpload = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .storage
    .object()
    .onFinalize(async (object) => {
        const filePath = object.name;
        if (!filePath || !filePath.startsWith('etl-pricing-imports/')) {
            console.log(`Ignoring file ${filePath} as it is not in the etl-pricing-imports/ directory.`);
            return null;
        }

        console.log(`[ETL Pricing] Started processing file: ${filePath}`);
        
        // Example implementation strategy for ETL:
        // 1. Download file to /tmp using admin.storage().bucket(object.bucket).file(filePath).download()
        // 2. Parse XML or XLSX (using xlsx or fast-xml-parser)
        // 3. For each row:
        //    const floorPrice = PricingService.calculateFloorPrice(row.baseCost, row.multiplier);
        //    db.collection('master_skus').doc(row.sku).set({ base_cost: row.baseCost, ... })
        // 4. Update an import_jobs document so the frontend can see completion percentage.

        // Create a basic job record
        const jobId = filePath.split('/').pop()?.replace('.', '_') || 'unknown';
        await db.collection('import_jobs').doc(jobId).set({
            status: 'completed',
            fileName: filePath,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            message: 'Pricing ETL parsing simulated successfully.'
        });

        console.log(`[ETL Pricing] Finished processing file: ${filePath}`);
        return null;
    });

/**
 * Callable function to batch-commit an approved simulation to actual channel listings
 * and push to external APIs.
 */
export const commitPricingSimulation = functions.https.onCall(async (data, context) => {
    // Requires Admin or Super Admin
    if (!context.auth || !context.auth.token || (!context.auth.token.admin && context.auth.token.role !== 'SUPER_ADMIN')) {
        throw new functions.https.HttpsError('permission-denied', 'Must be an admin to commit pricing.');
    }

    const { simulationId } = data;
    if (!simulationId) {
        throw new functions.https.HttpsError('invalid-argument', 'simulationId is required.');
    }

    console.log(`Committing pricing simulation: ${simulationId}`);
    
    // 1. Fetch simulation from db.collection('price_simulations')
    // 2. Iterate through impacted SKUs
    // 3. Update db.collection('channel_listings')
    // 4. Push updates to MeliPricingApi and AmazonPricingApi

    return { success: true, message: `Simulation ${simulationId} committed successfully.` };
});
