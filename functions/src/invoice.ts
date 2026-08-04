/**
 * invoice.ts
 * End-to-end CFDI 4.0 Invoicing integration powered by SW Sapien PAC.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './shared';
import { getValidMeliToken } from './meli-shared';
import { getSwSapienConfig, getSwSapienToken, stampCfdiXml, generateCfdiPdf, cancelCfdiXml } from './sw-sapien-client';
import { buildCfdi40Xml } from './cfdi-builder';

export const generateInvoice = functions
    .runWith({ timeoutSeconds: 120 })
    .https.onCall(async (data: { orderId: string }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in to generate invoices.');
        }

        const { orderId } = data;
        if (!orderId) {
            throw new functions.https.HttpsError('invalid-argument', 'orderId parameter is required.');
        }

        // 1. Fetch order document
        const orderRef = db.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (!orderSnap.exists) {
            throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
        }

        const order = orderSnap.data() as any;

        // 2. Extract recipient tax info (supports MeLi billing info or direct customer billing)
        const inv = order.meliInvoice || order.billingInfo || order.customer || {};
        const rfc = (inv.rfc || inv.taxId || '').toUpperCase().trim();
        const nombre = (inv.name || inv.billingName || order.customer?.name || '').trim();
        const domicilioFiscalReceptor = (inv.billingAddress?.zipCode || inv.zipCode || order.shippingAddress?.zipCode || '').trim();
        const regimenFiscalReceptor = (inv.taxpayerType || inv.taxSystem || '601').toString().trim();
        const usoCfdi = (inv.cfdiUse || 'G03').toString().trim();

        // Basic Fiscal Validations
        const missing: string[] = [];
        if (!rfc) missing.push('RFC');
        if (!nombre) missing.push('Nombre / Razón Social');
        if (!domicilioFiscalReceptor) missing.push('Código Postal Receptor');
        if (!regimenFiscalReceptor) missing.push('Régimen Fiscal');

        if (missing.length > 0) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Datos fiscales incompletos para facturar: ${missing.join(', ')}`
            );
        }

        // 3. Load SW Sapien credentials & config
        const swConfig = await getSwSapienConfig();

        // 4. Build line items
        const rawItems = order.items || order.order_items || [];
        if (rawItems.length === 0) {
            throw new functions.https.HttpsError('failed-precondition', 'La orden no contiene conceptos/productos.');
        }

        const conceptos = rawItems.map((item: any) => {
            const qty = Number(item.quantity || item.qty || 1);
            const totalItemAmount = Number(item.unitPrice || item.unit_price || item.price || 0);
            // Deduct VAT from gross unit price if stored gross (16% VAT standard in Mexico)
            const valorUnitarioNeto = totalItemAmount / 1.16;

            return {
                claveProdServ: item.satCode || item.claveProdServ || '25172500',
                noIdentificacion: item.sku || item.seller_sku || item.id || '',
                cantidad: qty,
                claveUnidad: item.unitCode || 'H87',
                unidad: item.unit || 'Pieza',
                descripcion: item.title || item.description || item.name || 'Producto Eurollantas',
                valorUnitario: valorUnitarioNeto
            };
        });

        // 5. Generate CFDI 4.0 XML
        const rawXml = buildCfdi40Xml({
            serie: 'A',
            folio: order.orderNumber || orderId.slice(-6),
            fecha: new Date(),
            formaPago: order.paymentForm || '03', // 03 Transferencia, 04 Tarjeta, 01 Efectivo, 99 Por definir
            metodoPago: 'PUE',
            moneda: 'MXN',
            lugarExpedicion: swConfig.lugarExpedicion,
            emisor: {
                rfc: swConfig.rfcEmisor,
                nombre: swConfig.nombreEmisor,
                regimenFiscal: swConfig.regimenFiscalEmisor
            },
            receptor: {
                rfc,
                nombre,
                domicilioFiscalReceptor,
                regimenFiscalReceptor,
                usoCfdi
            },
            conceptos
        });

        // 6. Stamp XML via SW Sapien PAC
        const stampResult = await stampCfdiXml(rawXml, swConfig);

        if (!stampResult.success || !stampResult.uuid || !stampResult.xml) {
            await orderRef.update({
                invoiceStatus: 'failed',
                invoiceError: stampResult.error || 'Error de timbrado SW Sapien',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            throw new functions.https.HttpsError('internal', `Error PAC SW Sapien: ${stampResult.error}`);
        }

        // 7. Generate PDF via SW Sapien PDF API
        const pdfBase64 = (await generateCfdiPdf(stampResult.xml!, swConfig)) ?? '';

        // 8. Upload XML & PDF to Firebase Storage
        const bucket = admin.storage().bucket();
        const xmlFilePath = `invoices/${orderId}/${stampResult.uuid}.xml`;
        const pdfFilePath = `invoices/${orderId}/${stampResult.uuid}.pdf`;

        const xmlFile = bucket.file(xmlFilePath);
        await xmlFile.save(Buffer.from(stampResult.xml, 'utf-8'), {
            contentType: 'application/xml',
            metadata: { firebaseStorageDownloadTokens: stampResult.uuid }
        });

        let xmlUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(xmlFilePath)}?alt=media&token=${stampResult.uuid}`;
        let pdfUrl: string | null = null;

        if (pdfBase64) {
            const pdfFile = bucket.file(pdfFilePath);
            await pdfFile.save(Buffer.from(pdfBase64, 'base64'), {
                contentType: 'application/pdf',
                metadata: { firebaseStorageDownloadTokens: stampResult.uuid }
            });
            pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(pdfFilePath)}?alt=media&token=${stampResult.uuid}`;
        }

        // 9. Update order document in Firestore
        await orderRef.update({
            invoiceStatus: 'issued',
            invoiceUuid: stampResult.uuid,
            invoiceXmlUrl: xmlUrl,
            invoicePdfUrl: pdfUrl,
            selloSAT: stampResult.selloSAT || null,
            noCertificadoSAT: stampResult.noCertificadoSAT || null,
            fechaTimbrado: stampResult.fechaTimbrado || null,
            invoicedAt: admin.firestore.FieldValue.serverTimestamp(),
            invoiceError: null
        });

        return {
            success: true,
            uuid: stampResult.uuid,
            xmlUrl,
            pdfUrl
        };
    });

export const cancelInvoice = functions
    .runWith({ timeoutSeconds: 60 })
    .https.onCall(async (data: { orderId: string; motivo?: string; uuidSustitucion?: string }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in to cancel invoices.');
        }

        const { orderId, motivo = '02', uuidSustitucion } = data;
        if (!orderId) {
            throw new functions.https.HttpsError('invalid-argument', 'orderId parameter is required.');
        }

        const orderRef = db.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (!orderSnap.exists) {
            throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
        }

        const order = orderSnap.data() as any;
        if (!order.invoiceUuid) {
            throw new functions.https.HttpsError('failed-precondition', 'Order has no issued invoice UUID.');
        }

        const swConfig = await getSwSapienConfig();
        const result = await cancelCfdiXml(order.invoiceUuid, motivo, uuidSustitucion || null, swConfig);

        if (!result.success) {
            throw new functions.https.HttpsError('internal', `Error cancelando CFDI: ${result.error}`);
        }

        await orderRef.update({
            invoiceStatus: 'cancelled',
            invoiceCancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
            success: true,
            uuid: order.invoiceUuid,
            ackXml: result.ackXml
        };
    });

// ─── Debug: Test MercadoLibre Billing Info ────────────────────────────────
export const testMeliBilling = functions.https.onRequest(async (req: any, res: any) => {
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).json({ error: 'MercadoLibre is not connected.' });
            return;
        }

        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_desc&limit=5`;
        const apiRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await apiRes.json() as any;
        const meliOrders = json.results || [];

        const results = [];
        for (const mo of meliOrders) {
            let bDataV2 = null;
            let bDataV1 = null;

            // Try v2
            const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-version': '2' }
            });
            if (bRes.ok) {
                bDataV2 = await bRes.json();
            } else {
                bDataV2 = { error: bRes.status, text: await bRes.text() };
            }

            // Try v1
            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
            });
            if (bRes1.ok) {
                bDataV1 = await bRes1.json();
            } else {
                bDataV1 = { error: bRes1.status, text: await bRes1.text() };
            }

            results.push({
                orderId: mo.id,
                buyerName: mo.buyer?.nickname || mo.buyer?.first_name,
                requestedInvoice: !!bDataV2?.billing_info?.doc_number && bDataV2.billing_info.doc_number.toUpperCase() !== 'XAXX010101000',
                rawBillingInfoV2: bDataV2,
                rawBillingInfoV1: bDataV1
            });
        }

        res.json({ success: true, disclaimer: "Raw MercadoLibre API Response", data: results });
    } catch (err: any) {
        console.error('Debug endpoint error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── SW Sapien Integration Debug & Test Callables ──────────────────────────
export const testSwSapienConnection = functions.https.onCall(async (data, context) => {
    try {
        const swConfig = await getSwSapienConfig();
        const token = await getSwSapienToken(swConfig);
        return {
            success: true,
            message: 'Conexión exitosa con PAC SW Sapien.',
            tokenPreview: token.substring(0, 15) + '...',
            isSandbox: !!swConfig.isSandbox,
            rfcEmisor: swConfig.rfcEmisor,
            nombreEmisor: swConfig.nombreEmisor,
            lugarExpedicion: swConfig.lugarExpedicion
        };
    } catch (err: any) {
        console.error('[testSwSapienConnection] Error:', err);
        return {
            success: false,
            error: err.message || err.toString() || 'Error de autenticación SW Sapien.'
        };
    }
});

export const testSwSapienStamp = functions.https.onCall(async (data: {
    rfcReceptor?: string;
    nombreReceptor?: string;
    zipReceptor?: string;
    regimenReceptor?: string;
    usoCfdi?: string;
    descripcion?: string;
    monto?: number;
}, context) => {
    try {
        const swConfig = await getSwSapienConfig();
        const rfcReceptor = (data.rfcReceptor || 'XAXX010101000').toUpperCase().trim();
        const nombreReceptor = (data.nombreReceptor || 'PUBLICO EN GENERAL').toUpperCase().trim();
        const zipReceptor = (data.zipReceptor || swConfig.lugarExpedicion).trim();
        const regimenReceptor = (data.regimenReceptor || '616').trim();
        const usoCfdi = (data.usoCfdi || 'S01').trim();
        const montoTotal = Number(data.monto || 100);
        const valorUnitario = montoTotal / 1.16;

        const rawXml = buildCfdi40Xml({
            serie: 'TEST',
            folio: String(Math.floor(100000 + Math.random() * 900000)),
            fecha: new Date(),
            formaPago: '01',
            metodoPago: 'PUE',
            moneda: 'MXN',
            lugarExpedicion: swConfig.lugarExpedicion,
            emisor: {
                rfc: swConfig.rfcEmisor,
                nombre: swConfig.nombreEmisor,
                regimenFiscal: swConfig.regimenFiscalEmisor
            },
            receptor: {
                rfc: rfcReceptor,
                nombre: nombreReceptor,
                domicilioFiscalReceptor: zipReceptor,
                regimenFiscalReceptor: regimenReceptor,
                usoCfdi
            },
            conceptos: [{
                claveProdServ: '25172500',
                noIdentificacion: 'TEST-SKU-001',
                cantidad: 1,
                claveUnidad: 'H87',
                unidad: 'Pieza',
                descripcion: data.descripcion || 'Producto de prueba SW Sapien PAC',
                valorUnitario
            }]
        });

        const stampResult = await stampCfdiXml(rawXml, swConfig);

        if (!stampResult.success || !stampResult.xml) {
            return {
                success: false,
                rawXml,
                error: stampResult.error || 'Falló el timbrado con SW Sapien.'
            };
        }

        let pdfBase64 = '';
        try {
            pdfBase64 = (await generateCfdiPdf(stampResult.xml!, swConfig)) ?? '';
        } catch (pdfErr: any) {
            console.warn('[testSwSapienStamp] PDF warning:', pdfErr);
        }

        return {
            success: true,
            uuid: stampResult.uuid,
            rawXml,
            stampedXml: stampResult.xml,
            pdfBase64,
            selloSAT: stampResult.selloSAT,
            fechaTimbrado: stampResult.fechaTimbrado
        };
    } catch (err: any) {
        console.error('[testSwSapienStamp] Error:', err);
        return {
            success: false,
            error: err.message || err.toString() || 'Error en prueba de timbrado.'
        };
    }
});
