const fs = require('fs');
const path = require('path');

const srcDir = './projects/internal-app/src/app/pages/command-center';
const esFile = './projects/internal-app/src/assets/i18n/es.json';
const enFile = './projects/internal-app/src/assets/i18n/en.json';

const esData = JSON.parse(fs.readFileSync(esFile, 'utf8'));
const enData = JSON.parse(fs.readFileSync(enFile, 'utf8'));

// Deep merge helper
function deepMerge(target, source) {
    for (const key in source) {
        if (source[key] instanceof Object && !Array.isArray(source[key])) {
            if (!target[key]) Object.assign(target, { [key]: {} });
            deepMerge(target[key], source[key]);
        } else {
            if (target[key] === undefined) {
                target[key] = source[key];
            }
        }
    }
}

// Convert KEY_NAME to "Key Name" (English fallback)
// and a simple Spanish heuristic (or just use the capitalized version)
function humanize(str, lang) {
    let result = str.toLowerCase().replace(/_/g, ' ');
    result = result.replace(/\b\w/g, c => c.toUpperCase());
    
    if (lang === 'es') {
        const dict = {
            'New Customers': 'Clientes Nuevos',
            'Returning Customers': 'Clientes Recurrentes',
            'Active Growth': 'Crecimiento Activo',
            'Avg Clv': 'LTV Promedio',
            'Ltv Desc': 'Valor a Largo Plazo',
            'Churn Rate': 'Tasa de Abandono',
            'Churn Desc': 'Abandono de Clientes',
            'At Risk Value': 'Valor en Riesgo',
            'Potential Loss': 'Pérdida Potencial',
            'Acquisition': 'Adquisición',
            'Acquisition Desc': 'Adquisición de Clientes',
            'Segmentation': 'Segmentación',
            'Customer': 'Cliente',
            'Segment': 'Segmento',
            'Days Since': 'Días Desde',
            'Orders': 'Pedidos',
            'Ltv': 'LTV',
            'Cohorts': 'Cohortes',
            'Title': 'Título',
            'Subtitle': 'Subtítulo',
            'Info Title': 'Información',
            'Info Desc': 'Descripción',
            'Legend': 'Leyenda',
            'Cohort': 'Cohorte',
            'Users': 'Usuarios',
            'Month': 'Mes',
            'Total Spent': 'Gasto Total',
            'Last Order': 'Último Pedido',
            'Risk Score': 'Nivel de Riesgo',
            'Action': 'Acción',
            'Contact': 'Contactar',
            'Start': 'Iniciar',
            'Dashboard Subtitle': 'Resumen del Tablero',
            'Loading System': 'Cargando Sistema',
            'Revenue Trend': 'Tendencia de Ingresos',
            'Selected Range': 'Rango Seleccionado',
            'Order Distribution': 'Distribución de Pedidos',
            'Top Products': 'Mejores Productos',
            'Top 5 By Revenue': 'Top 5 por Ingresos',
            'Date': 'Fecha',
            'Status': 'Estado',
            'Revenue': 'Ingresos',
            'Sales Analytics': 'Análisis de Ventas',
            'Financials': 'Finanzas',
            'Periods': 'Periodos',
            'Today': 'Hoy',
            'Yesterday': 'Ayer',
            'Last 7 Days': 'Últimos 7 Días',
            'Last 30 Days': 'Últimos 30 Días',
            'Mtd': 'Mes a la Fecha',
            'Last Month': 'Mes Pasado',
            'Quick Periods': 'Periodos Rápidos',
            'Start Date': 'Fecha de Inicio',
            'End Date': 'Fecha de Fin',
            'User Fallback': 'Usuario',
            'Ai Analyst': 'Analista IA',
            'Insights': 'Perspectivas',
            'Impact': 'Impacto',
            'Headline': 'Titular',
            'Neutral': 'Neutral',
            'Positive': 'Positivo',
            'Negative': 'Negativo',
            'Mixed Growth Pain': 'Crecimiento Mixto',
            'Mixed Soft Revenue': 'Ingresos Mixtos',
            'Revenue Miss': 'Pérdida de Ingresos',
            'Strong Sales': 'Ventas Fuertes',
            'Inventory Drag': 'Arrastre de Inventario',
            'Supply Chain Risk': 'Riesgo en Cadena de Suministro',
            'Sla Breach': 'Incumplimiento SLA',
            'Fulfillment Bottleneck': 'Cuello de Botella',
            'Hero Product Risk': 'Riesgo Producto Estrella',
            'Dead Stock': 'Inventario Muerto',
            'Category Dominance': 'Dominancia de Categoría',
            'Miss': 'Pérdida',
            'Lift': 'Mejora',
            'High Correlation': 'Alta Correlación',
            'Sla Risk': 'Riesgo SLA',
            'Opportunity Cost': 'Costo de Oportunidad',
            'Concentration': 'Concentración',
            'Approvals': 'Aprobaciones',
            'Types': 'Tipos',
            'Back': 'Volver',
            'Auto Approved': 'Auto Aprobado',
            'Priority': 'Prioridad',
            'Request Details': 'Detalles de la Solicitud',
            'Coupon Code': 'Código de Cupón',
            'Discount Type': 'Tipo de Descuento',
            'Discount Value': 'Valor de Descuento',
            'Min Purchase': 'Compra Mínima',
            'Usage Limit': 'Límite de Uso',
            'Product': 'Producto',
            'Sku': 'SKU',
            'Current Price': 'Precio Actual',
            'New Price': 'Nuevo Precio',
            'Change Percent': 'Porcentaje de Cambio',
            'Reason': 'Razón',
            'Review Details': 'Detalles de Revisión',
            'Reviewed By': 'Revisado Por',
            'Reviewed At': 'Revisado En',
            'Reviewer Notes': 'Notas del Revisor',
            'Rejection Reason': 'Razón de Rechazo',
            'Timeline': 'Línea de Tiempo',
            'Request Created': 'Solicitud Creada',
            'Request Approved': 'Solicitud Aprobada',
            'Request Rejected': 'Solicitud Rechazada',
            'Requester Info': 'Info Solicitante',
            'Name': 'Nombre',
            'Email': 'Correo',
            'Role': 'Rol',
            'Loading': 'Cargando',
            'Approve Request': 'Aprobar Solicitud',
            'Approve Confirm Message': 'Mensaje de Confirmación',
            'Notes Placeholder': 'Notas...',
            'Actions': 'Acciones',
            'Cancel': 'Cancelar',
            'Processing': 'Procesando',
            'Reject Request': 'Rechazar Solicitud',
            'Reject Confirm Message': 'Confirmación de Rechazo',
            'Rejection Placeholder': 'Razón del rechazo...',
            'Pending': 'Pendiente',
            'Approved': 'Aprobado',
            'Rejected': 'Rechazado',
            'Filters': 'Filtros',
            'Type': 'Tipo',
            'All': 'Todos',
            'Coupon Creation': 'Creación de Cupón',
            'Flash Sale': 'Venta Flash',
            'Price Change': 'Cambio de Precio',
            'Bulk Discount': 'Descuento por Volumen',
            'Promotion Creation': 'Creación de Promoción',
            'Urgent': 'Urgente',
            'High': 'Alta',
            'Normal': 'Normal',
            'Low': 'Baja',
            'Search': 'Buscar',
            'Search Placeholder': 'Buscar...',
            'No Pending': 'Sin Pendientes',
            'No Matching Requests': 'Sin Coincidencias'
        };
        return dict[result] || result;
    }
    return result;
}

function walkSync(dir, filelist = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filepath = path.join(dir, file);
        if (fs.statSync(filepath).isDirectory()) {
            filelist = walkSync(filepath, filelist);
        } else {
            filelist.push(filepath);
        }
    }
    return filelist;
}

const files = walkSync(srcDir);
const keyPattern = /'COMMAND_CENTER\.([A-Z0-9_.]+)'/g;
const doubleQuotePattern = /"COMMAND_CENTER\.([A-Z0-9_.]+)"/g;

const newKeysEs = {};
const newKeysEn = {};

function processMatch(keyStr) {
    const parts = keyStr.split('.');
    
    let curEs = newKeysEs;
    let curEn = newKeysEn;
    
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '') continue; // ignore trailing dots
        if (i === parts.length - 1) {
            if (curEs[part] === undefined) curEs[part] = humanize(part, 'es');
            if (curEn[part] === undefined) curEn[part] = humanize(part, 'en');
        } else {
            if (!curEs[part]) curEs[part] = {};
            if (!curEn[part]) curEn[part] = {};
            curEs = curEs[part];
            curEn = curEn[part];
        }
    }
}

files.forEach(file => {
    if (!file.endsWith('.ts') && !file.endsWith('.html')) return;
    const content = fs.readFileSync(file, 'utf8');
    
    let match;
    while ((match = keyPattern.exec(content)) !== null) {
        processMatch(match[1]);
    }
    while ((match = doubleQuotePattern.exec(content)) !== null) {
        processMatch(match[1]);
    }
});

// We want to insert this into COMMAND_CENTER root
const esUpdates = { COMMAND_CENTER: newKeysEs };
const enUpdates = { COMMAND_CENTER: newKeysEn };

deepMerge(esData, esUpdates);
deepMerge(enData, enUpdates);

fs.writeFileSync(esFile, JSON.stringify(esData, null, 2));
fs.writeFileSync(enFile, JSON.stringify(enData, null, 2));

console.log("Successfully extracted and merged all missing COMMAND_CENTER keys into internal-app's es.json and en.json");
