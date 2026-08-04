"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSwSapienStamp = exports.testSwSapienConnection = exports.testMeliBilling = exports.cancelInvoice = exports.generateInvoice = void 0;
/**
 * invoice.ts
 * End-to-end CFDI 4.0 Invoicing integration powered by SW Sapien PAC.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
const sw_sapien_client_1 = require("./sw-sapien-client");
const cfdi_builder_1 = require("./cfdi-builder");
exports.generateInvoice = functions
    .runWith({ timeoutSeconds: 120 })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in to generate invoices.');
    }
    const { orderId } = data;
    if (!orderId) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId parameter is required.');
    }
    // 1. Fetch order document
    const orderRef = shared_1.db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
    }
    const order = orderSnap.data();
    // 2. Extract recipient tax info (supports MeLi billing info or direct customer billing)
    const inv = order.meliInvoice || order.billingInfo || order.customer || {};
    const rfc = (inv.rfc || inv.taxId || '').toUpperCase().trim();
    const nombre = (inv.name || inv.billingName || ((_a = order.customer) === null || _a === void 0 ? void 0 : _a.name) || '').trim();
    const domicilioFiscalReceptor = (((_b = inv.billingAddress) === null || _b === void 0 ? void 0 : _b.zipCode) || inv.zipCode || ((_c = order.shippingAddress) === null || _c === void 0 ? void 0 : _c.zipCode) || '').trim();
    const regimenFiscalReceptor = (inv.taxpayerType || inv.taxSystem || '601').toString().trim();
    const usoCfdi = (inv.cfdiUse || 'G03').toString().trim();
    // Basic Fiscal Validations
    const missing = [];
    if (!rfc)
        missing.push('RFC');
    if (!nombre)
        missing.push('Nombre / Razón Social');
    if (!domicilioFiscalReceptor)
        missing.push('Código Postal Receptor');
    if (!regimenFiscalReceptor)
        missing.push('Régimen Fiscal');
    if (missing.length > 0) {
        throw new functions.https.HttpsError('failed-precondition', `Datos fiscales incompletos para facturar: ${missing.join(', ')}`);
    }
    // 3. Load SW Sapien credentials & config
    const swConfig = await (0, sw_sapien_client_1.getSwSapienConfig)();
    // 4. Build line items
    const rawItems = order.items || order.order_items || [];
    if (rawItems.length === 0) {
        throw new functions.https.HttpsError('failed-precondition', 'La orden no contiene conceptos/productos.');
    }
    const conceptos = rawItems.map((item) => {
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
    const rawXml = (0, cfdi_builder_1.buildCfdi40Xml)({
        serie: 'A',
        folio: order.orderNumber || orderId.slice(-6),
        fecha: new Date(),
        formaPago: order.paymentForm || '03',
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
    const stampResult = await (0, sw_sapien_client_1.stampCfdiXml)(rawXml, swConfig);
    if (!stampResult.success || !stampResult.uuid || !stampResult.xml) {
        await orderRef.update({
            invoiceStatus: 'failed',
            invoiceError: stampResult.error || 'Error de timbrado SW Sapien',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        throw new functions.https.HttpsError('internal', `Error PAC SW Sapien: ${stampResult.error}`);
    }
    // 7. Generate PDF via SW Sapien PDF API
    const pdfBase64 = (_d = (await (0, sw_sapien_client_1.generateCfdiPdf)(stampResult.xml, swConfig))) !== null && _d !== void 0 ? _d : '';
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
    let pdfUrl = null;
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
exports.cancelInvoice = functions
    .runWith({ timeoutSeconds: 60 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in to cancel invoices.');
    }
    const { orderId, motivo = '02', uuidSustitucion } = data;
    if (!orderId) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId parameter is required.');
    }
    const orderRef = shared_1.db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
    }
    const order = orderSnap.data();
    if (!order.invoiceUuid) {
        throw new functions.https.HttpsError('failed-precondition', 'Order has no issued invoice UUID.');
    }
    const swConfig = await (0, sw_sapien_client_1.getSwSapienConfig)();
    const result = await (0, sw_sapien_client_1.cancelCfdiXml)(order.invoiceUuid, motivo, uuidSustitucion || null, swConfig);
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
exports.testMeliBilling = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d;
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).json({ error: 'MercadoLibre is not connected.' });
            return;
        }
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_desc&limit=5`;
        const apiRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await apiRes.json();
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
            }
            else {
                bDataV2 = { error: bRes.status, text: await bRes.text() };
            }
            // Try v1
            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
            });
            if (bRes1.ok) {
                bDataV1 = await bRes1.json();
            }
            else {
                bDataV1 = { error: bRes1.status, text: await bRes1.text() };
            }
            results.push({
                orderId: mo.id,
                buyerName: ((_b = mo.buyer) === null || _b === void 0 ? void 0 : _b.nickname) || ((_c = mo.buyer) === null || _c === void 0 ? void 0 : _c.first_name),
                requestedInvoice: !!((_d = bDataV2 === null || bDataV2 === void 0 ? void 0 : bDataV2.billing_info) === null || _d === void 0 ? void 0 : _d.doc_number) && bDataV2.billing_info.doc_number.toUpperCase() !== 'XAXX010101000',
                rawBillingInfoV2: bDataV2,
                rawBillingInfoV1: bDataV1
            });
        }
        res.json({ success: true, disclaimer: "Raw MercadoLibre API Response", data: results });
    }
    catch (err) {
        console.error('Debug endpoint error:', err);
        res.status(500).json({ error: err.message });
    }
});
// ─── SW Sapien Integration Debug & Test Callables ──────────────────────────
exports.testSwSapienConnection = functions.https.onCall(async (data, context) => {
    try {
        const swConfig = await (0, sw_sapien_client_1.getSwSapienConfig)();
        const token = await (0, sw_sapien_client_1.getSwSapienToken)(swConfig);
        return {
            success: true,
            message: 'Conexión exitosa con PAC SW Sapien.',
            tokenPreview: token.substring(0, 15) + '...',
            isSandbox: !!swConfig.isSandbox,
            rfcEmisor: swConfig.rfcEmisor,
            nombreEmisor: swConfig.nombreEmisor,
            lugarExpedicion: swConfig.lugarExpedicion
        };
    }
    catch (err) {
        console.error('[testSwSapienConnection] Error:', err);
        return {
            success: false,
            error: err.message || err.toString() || 'Error de autenticación SW Sapien.'
        };
    }
});
exports.testSwSapienStamp = functions.https.onCall(async (data, context) => {
    var _a;
    try {
        const swConfig = await (0, sw_sapien_client_1.getSwSapienConfig)();
        const rfcReceptor = (data.rfcReceptor || 'XAXX010101000').toUpperCase().trim();
        const nombreReceptor = (data.nombreReceptor || 'PUBLICO EN GENERAL').toUpperCase().trim();
        const zipReceptor = (data.zipReceptor || swConfig.lugarExpedicion).trim();
        const regimenReceptor = (data.regimenReceptor || '616').trim();
        const usoCfdi = (data.usoCfdi || 'S01').trim();
        const montoTotal = Number(data.monto || 100);
        const valorUnitario = montoTotal / 1.16;
        const rawXml = (0, cfdi_builder_1.buildCfdi40Xml)({
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
        const stampResult = await (0, sw_sapien_client_1.stampCfdiXml)(rawXml, swConfig);
        if (!stampResult.success || !stampResult.xml) {
            return {
                success: false,
                rawXml,
                error: stampResult.error || 'Falló el timbrado con SW Sapien.'
            };
        }
        let pdfBase64 = '';
        try {
            pdfBase64 = (_a = (await (0, sw_sapien_client_1.generateCfdiPdf)(stampResult.xml, swConfig))) !== null && _a !== void 0 ? _a : '';
        }
        catch (pdfErr) {
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
    }
    catch (err) {
        console.error('[testSwSapienStamp] Error:', err);
        return {
            success: false,
            error: err.message || err.toString() || 'Error en prueba de timbrado.'
        };
    }
});
//# sourceMappingURL=invoice.js.map