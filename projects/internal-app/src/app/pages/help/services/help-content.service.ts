import { Injectable, inject } from '@angular/core';
import { Observable, map, startWith } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

export interface HelpTopic {
    id: string;
    title: string;
    description: string;
    category: 'operations' | 'sales' | 'inventory' | 'admin';
    icon: string;
    workflowDefinition?: string;
    content: string;
    tourId?: string;
}

interface LocalizedTopicData {
    id: string;
    category: 'operations' | 'sales' | 'inventory' | 'admin';
    icon: string;
    tourId?: string;
    en: { title: string; description: string; content: string; workflowDefinition?: string };
    es: { title: string; description: string; content: string; workflowDefinition?: string };
}

@Injectable({
    providedIn: 'root'
})
export class HelpContentService {
    private translate = inject(TranslateService);

    constructor() { }

    getTopics(): Observable<HelpTopic[]> {
        return this.translate.onLangChange.pipe(
            startWith({ lang: this.translate.currentLang || 'en' }),
            map(event => event.lang),
            map(lang => {
                const isSpanish = lang === 'es';
                return this.rawTopics.map(topic => {
                    const data = isSpanish ? topic.es : topic.en;
                    return {
                        id: topic.id,
                        category: topic.category,
                        icon: topic.icon,
                        tourId: topic.tourId,
                        ...data
                    };
                });
            })
        );
    }

    getTopicById(id: string): Observable<HelpTopic | undefined> {
        return this.getTopics().pipe(
            map(topics => topics.find(t => t.id === id))
        );
    }

    private get rawTopics(): LocalizedTopicData[] {
        return [
            {
                id: 'fulfillment-process',
                category: 'operations',
                icon: 'box',
                en: {
                    title: 'Tire Order Fulfillment',
                    description: 'Step-by-step from picking tires to shipping compliance.',
                    content: `
                        <h2>How to Fulfill a Tire Order</h2>
                        <p>The fulfillment process ensures that customer orders are picked accurately (matching sizes/brands), packed safely, and shipped promptly.</p>
                        <ol class="list-decimal pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Order Received:</strong> New orders appear in the queue with "Pending" status.</li>
                            <li><strong>Picking:</strong> Use the scanner to verify DOT codes and sizes match the order perfectly.</li>
                            <li><strong>Staging:</strong> Bundle tires (usually in pairs) and apply shipping labels directly to tread or sidewall wrapping.</li>
                            <li><strong>Shipping:</strong> Hand off to carrier (FedEx/Freight) and log the tracking number.</li>
                        </ol>
                    `,
                    workflowDefinition: `
                        stateDiagram-v2
                            [*] --> Pending
                            Pending --> Authorized : Payment Success
                            Pending --> Cancelled : Payment Failed
                            
                            Authorized --> Picking : Order Printed
                            Picking --> Staged : Tires Pulled & Verified
                            
                            Staged --> Shipped : Labels Applied
                            Shipped --> Delivered : Customer Signed
                            Shipped --> Returned : Refused/Failed
                            
                            Delivered --> [*]
                    `
                },
                es: {
                    title: 'Cumplimiento de Pedidos de Llantas',
                    description: 'Paso a paso desde la recolección hasta el envío.',
                    content: `
                        <h2>Cómo Cumplir con un Pedido de Llantas</h2>
                        <p>El proceso de cumplimiento asegura que los pedidos se recolecten con precisión (marcas/medidas), se empaquen y envíen.</p>
                        <ol class="list-decimal pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Pedido Recibido:</strong> Nuevos pedidos aparecen en "Pendiente".</li>
                            <li><strong>Picking:</strong> Use el escáner para verificar códigos DOT y medidas.</li>
                            <li><strong>Preparación:</strong> Agrupe llantas (usualmente pares) y coloque etiquetas.</li>
                            <li><strong>Envío:</strong> Entregue al transportista y registre el rastreo.</li>
                        </ol>
                    `,
                    workflowDefinition: `
                        stateDiagram-v2
                            [*] --> Pendiente
                            Pendiente --> Autorizado : Pago Exitoso
                            Pendiente --> Cancelado : Pago Fallido
                            
                            Autorizado --> Picking : Orden Impresa
                            Picking --> Preparado : Llantas Verificadas
                            
                            Preparado --> Enviado : Etiquetas Listas
                            Enviado --> Entregado : Firma Cliente
                            Enviado --> Devuelto : Rechazado
                            
                            Entregado --> [*]
                    `
                }
            },
            {
                id: 'inventory-receiving',
                category: 'inventory',
                icon: 'clipboard',
                tourId: 'inventory-receiving',
                en: {
                    title: 'Inventory Receiving',
                    description: 'Standard procedure for unloading containers and verifying DOT dates.',
                    content: `
                        <h2>Receiving New Tires</h2>
                        <p>Proper receiving is crucial. Verify counts and age (DOT codes) immediately.</p>
                        <ul class="list-disc pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Unloading:</strong> Count tires as they come off the container.</li>
                            <li><strong>Inspection:</strong> Check for bead damage or sidewall cuts. Randomly check DOT dates for freshness (under 3 years).</li>
                            <li><strong>System Entry:</strong> Receive against the PO. Flag short-ships immediately.</li>
                            <li><strong>Racking:</strong> Store vertically in racks (lacing pattern preferred for stability).</li>
                        </ul>
                    `,
                    workflowDefinition: `
                        mindmap
                          root((Inventory Health))
                            Receiving
                              DOT Verification
                                Check Mfg Date
                                Inspect Bead
                              Count
                            Storage
                              Racking
                                Vertical Lacing
                              Climate
                                Cool & Dry
                                No Direct Sun
                            Maintenance
                              Rotation
                                FIFO (First In First Out)
                    `
                },
                es: {
                    title: 'Recepción de Inventario',
                    description: 'Procedimiento para descargar contenedores y verificar fechas DOT.',
                    content: `
                        <h2>Recepción de Llantas Nuevas</h2>
                        <p>La recepción adecuada es clave. Verifique conteos y antigüedad (DOT) de inmediato.</p>
                        <ul class="list-disc pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Descarga:</strong> Cuente las llantas al bajar del contenedor.</li>
                            <li><strong>Inspección:</strong> Revise daños en ceja/lateral. Verifique fechas DOT (menos de 3 años).</li>
                            <li><strong>Ingreso:</strong> Reciba contra la PO. Reporte faltantes.</li>
                            <li><strong>Estibado:</strong> Almacene verticalmente en racks (patrón entrelazado).</li>
                        </ul>
                    `,
                    workflowDefinition: `
                        mindmap
                          root((Salud Inventario))
                            Recepción
                              Verificación DOT
                                Fecha Fabricación
                                Inspección Ceja
                              Conteo
                            Almacenaje
                              Racks
                                Estiba Vertical
                              Clima
                                Fresco y Seco
                                Sin Sol Directo
                            Mantenimiento
                              Rotación
                                FIFO (Primero Entra Primero Sale)
                    `
                }
            },
            {
                id: 'returns-rma',
                category: 'sales',
                icon: 'refresh',
                en: {
                    title: 'Returns & Warranties',
                    description: 'Processing returns and manufacturer defect warranties.',
                    content: `
                        <h2>Processing a Return (RMA)</h2>
                        <p>Handle returns efficiently to maintain trust.</p>
                        <ol class="list-decimal pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Request:</strong> Customer reports issue (Wrong size ordered / Defect).</li>
                            <li><strong>Inspection:</strong> Ensure tire has not been mounted or driven on (for returns). For warranty, measure tread depth.</li>
                            <li><strong>Resolution:</strong> Issue refund or manufacturer claim credit.</li>
                        </ol>
                    `,
                    workflowDefinition: `
                        gantt
                            title RMA / Warranty Process
                            dateFormat  X
                            axisFormat %d
                            
                            section Customer
                            Report Issue          :a1, 0, 1d
                            Ship Back             :after a1, 3d
                            
                            section Warehouse
                            Tread Inspection      :crit, after a1, 1d
                            Verify Mounting Mark  :after a1, 1d
                            
                            section Finance
                            Issue Refund/Credit   :after a1, 1d
                    `
                },
                es: {
                    title: 'Devoluciones y Garantías',
                    description: 'Procesamiento de devoluciones y garantías por defectos.',
                    content: `
                        <h2>Procesando una Devolución (RMA)</h2>
                        <p>Maneje las devoluciones eficientemente para mantener la confianza.</p>
                        <ol class="list-decimal pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Solicitud:</strong> Cliente reporta (Medida incorrecta / Defecto).</li>
                            <li><strong>Inspección:</strong> Asegure que no fue montada/rodada (devolución). Para garantía, mida profundidad.</li>
                            <li><strong>Resolución:</strong> Emita reembolso o crédito de reclamo.</li>
                        </ol>
                    `,
                    workflowDefinition: `
                        gantt
                            title Proceso RMA / Garantía
                            dateFormat  X
                            axisFormat %d
                            
                            section Cliente
                            Reportar Problema     :a1, 0, 1d
                            Enviar de Regreso     :after a1, 3d
                            
                            section Almacén
                            Inspección Banda      :crit, after a1, 1d
                            Verificar Montaje     :after a1, 1d
                            
                            section Finanzas
                            Reembolso/Crédito     :after a1, 1d
                    `
                }
            },
            {
                id: 'customer-journey',
                category: 'sales',
                icon: 'map',
                en: {
                    title: 'The Tire Buyer\'s Journey',
                    description: 'Lifecycle from needing tires to becoming a repeat customer.',
                    content: `
                        <h2>5 Stages of the Tire Buyer Journey</h2>
                        <ul class="list-disc pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Awareness:</strong> "My tread is low" or "I have a flat". Search for "tires near me".</li>
                            <li><strong>Consideration:</strong> Comparing brands (Michelin vs Bridgestone), reading reviews on wet grip/noise.</li>
                            <li><strong>Decision:</strong> Selecting the right size and checkout. booking installation.</li>
                            <li><strong>Retention:</strong> Rotations, balancing reminders, winter changeover emails.</li>
                            <li><strong>Advocacy:</strong> Recommending EuroLlantas to friends.</li>
                        </ul>
                    `,
                    workflowDefinition: `
                        journey
                            title Tire Purchase Experience
                            section Problem
                              Flat Tire: 5: Customer
                              Low Tread: 3: Customer
                            section Research
                              Check Size: 4: Customer
                              Compare Brands: 5: Customer
                            section Purchase
                              Checkout: 5: Customer
                              Installation: 4: Dealer
                            section Care
                              Rotation Reminder: 5: System
                    `
                },
                es: {
                    title: 'El Viaje del Comprador de Llantas',
                    description: 'Ciclo de vida desde la necesidad hasta la lealtad.',
                    content: `
                        <h2>5 Etapas del Comprador de Llantas</h2>
                        <ul class="list-disc pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Conciencia:</strong> "Mi llanta está lisa". Busca opciones.</li>
                            <li><strong>Consideración:</strong> Compara marcas, lee reseñas sobre agarre/ruido.</li>
                            <li><strong>Decisión:</strong> Selecciona medida, paga y agenda montaje.</li>
                            <li><strong>Retención:</strong> Recordatorios de rotación/balanceo.</li>
                            <li><strong>Abogacía:</strong> Recomienda EuroLlantas.</li>
                        </ul>
                    `,
                    workflowDefinition: `
                        graph LR
                            A[Necesidad] --> B[Comparación]
                            B --> C[Compra]
                            C --> D[Mantenimiento]
                            D --> E[Lealtad]
                            
                            style A fill:#64748b,stroke:#475569,color:#fff
                            style B fill:#3b82f6,stroke:#2563eb,color:#fff
                            style C fill:#22c55e,stroke:#16a34a,color:#fff
                            style D fill:#a855f7,stroke:#9333ea,color:#fff
                            style E fill:#f43f5e,stroke:#e11d48,color:#fff
                    `
                }
            },
            {
                id: 'ecommerce-analytics',
                category: 'admin',
                icon: 'trending-up',
                en: {
                    title: 'Tire Analytics & KPIs',
                    description: 'Key metrics for the tire business.',
                    content: `
                        <h2>Essential Tire E-commerce Metrics</h2>
                        <p>Tracking the right indicators for high-volume, low-margin goods.</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div class="p-4 bg-slate-800 rounded-lg border border-slate-700">
                                <h3 class="text-teal-400 font-bold mb-2">Metrics</h3>
                                <ul class="list-disc pl-5 space-y-1 text-slate-300">
                                    <li><strong>Fill Rate:</strong> % of orders fulfilled from immediate stock (crucial for tires).</li>
                                    <li><strong>AOV (Avg Order Value):</strong> Typically higher (Pair/Set).</li>
                                    <li><strong>Return Rate:</strong> Keep low by validating vehicle fitment data.</li>
                                </ul>
                            </div>
                        </div>
                    `,
                    workflowDefinition: `
                        graph TD
                            A[Marketing] -->|Traffic| B(Fitment Search)
                            B -->|Correct Size| C{Sales}
                            C -->|Pair/Set| D[Revenue High]
                            C -->|Recall| E[Repeat Seasonal]
                            E -->|LTV| F[Customer Value]
                            
                            style D fill:#22c55e,stroke:#16a34a,color:#fff
                            style F fill:#8b5cf6,stroke:#7c3aed,color:#fff
                    `
                },
                es: {
                    title: 'Analítica de Llantas y KPIs',
                    description: 'Métricas clave para el negocio de neumáticos.',
                    content: `
                        <h2>Métricas Esenciales</h2>
                        <p>Seguimiento de indicadores para bienes de volumen.</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div class="p-4 bg-slate-800 rounded-lg border border-slate-700">
                                <h3 class="text-teal-400 font-bold mb-2">Métricas</h3>
                                <ul class="list-disc pl-5 space-y-1 text-slate-300">
                                    <li><strong>Tasa de Surtido:</strong> % pedidos surtidos de stock inmediato.</li>
                                    <li><strong>AOV:</strong> Típicamente alto (Par/Juego).</li>
                                    <li><strong>Devoluciones:</strong> Mantener bajo validando datos de vehículo.</li>
                                </ul>
                            </div>
                        </div>
                    `,
                    workflowDefinition: `
                        graph TD
                            A[Marketing] -->|Tráfico| B(Búsqueda Medida)
                            B -->|Medida Correcta| C{Ventas}
                            C -->|Par/Juego| D[Ingresos Altos]
                            C -->|Recordatorio| E[Compra Estacional]
                            E -->|LTV| F[Valor Cliente]
                            
                            style D fill:#22c55e,stroke:#16a34a,color:#fff
                            style F fill:#8b5cf6,stroke:#7c3aed,color:#fff
                    `
                }
            },
            {
                id: 'inventory-strategies',
                category: 'inventory',
                icon: 'trending-up',
                en: {
                    title: 'Inventory Strategy',
                    description: 'Optimizing for seasonality and size proliferation.',
                    content: `
                        <h2>Strategies for Tire Inventory</h2>
                        <p>Managing thousands of SKUs (sizes/patterns) requires smart strategy.</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 mb-6">
                            <div class="p-4 bg-slate-800 rounded-lg border border-slate-700">
                                <h3 class="text-teal-400 font-bold mb-2">Seasonality</h3>
                                <p class="text-slate-300 text-sm">Stock up on Winter tires in Sept, Summer tires in March.</p>
                            </div>
                            <div class="p-4 bg-slate-800 rounded-lg border border-slate-700">
                                <h3 class="text-teal-400 font-bold mb-2">Pareto (80/20)</h3>
                                <p class="text-slate-300 text-sm">Focus deep stock on top 20 sizes (e.g. 120/70-17, 180/55-17).</p>
                            </div>
                        </div>
                    `,
                    workflowDefinition: `
                        graph TD
                            Start[Strategy] --> A{Season?}
                            A -->|Winter Prep| B[Stock All-Terrain/Winter]
                            A -->|Summer Prep| C[Stock Performance/Touring]
                            
                            Start --> D{Velocity}
                            D -->|High (Top 20)| E[Deep Stock]
                            D -->|Low (Exotic)| F[Order on Demand]
                            
                            style B fill:#3b82f6,stroke:#2563eb,color:#fff
                            style C fill:#f59e0b,stroke:#d97706,color:#fff
                    `
                },
                es: {
                    title: 'Estrategia de Inventario',
                    description: 'Optimizando para estacionalidad y proliferación de medidas.',
                    content: `
                        <h2>Estrategias para Llantas</h2>
                        <p>Manejar miles de SKUs requiere inteligencia.</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 mb-6">
                            <div class="p-4 bg-slate-800 rounded-lg border border-slate-700">
                                <h3 class="text-teal-400 font-bold mb-2">Estacionalidad</h3>
                                <p class="text-slate-300 text-sm">Surtir Invierno en Septiembre, Verano en Marzo.</p>
                            </div>
                            <div class="p-4 bg-slate-800 rounded-lg border border-slate-700">
                                <h3 class="text-teal-400 font-bold mb-2">Pareto (80/20)</h3>
                                <p class="text-slate-300 text-sm">Stock profundo en top 20 medidas (e.g. 120/70-17).</p>
                            </div>
                        </div>
                    `,
                    workflowDefinition: `
                        graph TD
                            Start[Estrategia] --> A{¿Estación?}
                            A -->|Invierno| B[Stock All-Terrain/Invierno]
                            A -->|Verano| C[Stock Desempeño/Touring]
                            
                            Start --> D{Rotación}
                            D -->|Alta (Top 20)| E[Stock Profundo]
                            D -->|Baja (Exóticos)| F[Sobre Pedido]
                            
                            style B fill:#3b82f6,stroke:#2563eb,color:#fff
                            style C fill:#f59e0b,stroke:#d97706,color:#fff
                    `
                }
            },
            {
                id: 'operational-excellence',
                category: 'operations',
                icon: 'cpu',
                en: {
                    title: 'Warehouse Operations',
                    description: 'Techniques for handling heavy, bulky tire inventory.',
                    content: `
                        <h2>Operational Excellence</h2>
                        <ul class="list-disc pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Lacing:</strong> Interlocking tires in stacks to prevent falling and maximize container space.</li>
                            <li><strong>Gravity Racks:</strong> Using gravity flow racks for fast-moving sizes to ensure FIFO.</li>
                        </ul>
                    `,
                    workflowDefinition: `
                        graph LR
                            A[Container] --> B{Sort}
                            B -->|Fast Mover| C[Gravity Flow Rack]
                            B -->|Slow Mover| D[Deep Stacking]
                            C --> E[Picking]
                            D --> E
                            
                            style C fill:#22c55e,stroke:#16a34a,color:#fff
                    `
                },
                es: {
                    title: 'Operaciones de Almacén',
                    description: 'Técnicas para manejo de inventario pesado y voluminoso.',
                    content: `
                        <h2>Excelencia Operacional</h2>
                        <ul class="list-disc pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Amarre (Lacing):</strong> Entrelazar llantas para estabilizar y maximizar espacio.</li>
                            <li><strong>Racks Gravedad:</strong> Para medidas de alta rotación, asegura FIFO.</li>
                        </ul>
                    `,
                    workflowDefinition: `
                        graph LR
                            A[Contenedor] --> B{Clasificar}
                            B -->|Alta Rotación| C[Rack Dinámico]
                            B -->|Baja Rotación| D[Estibado Profundo]
                            C --> E[Picking]
                            D --> E
                            
                            style C fill:#22c55e,stroke:#16a34a,color:#fff
                    `
                }
            },
            {
                id: 'marketing-mastery',
                category: 'sales',
                icon: 'target',
                en: {
                    title: 'Customer Segmentation',
                    description: 'Targeting fleets vs retail customers.',
                    content: `
                        <h2>Marketing Segments</h2>
                        <p>Different strategies for different buyers.</p>
                        <ul class="list-disc pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Retail:</strong> Focus on safety, ride comfort, and installation convenience.</li>
                            <li><strong>Fleets:</strong> Focus on cost-per-mile (CPM), durability, and bulk discounts.</li>
                        </ul>
                    `,
                    workflowDefinition: `
                        graph TD
                            Base[Customer Base] --> Type{Type?}
                            Type -->|Fleet| F[Cost Focus]
                            Type -->|Retail| R[Safety/Comfort Focus]
                            
                            F --> F1(Volume Discount)
                            R --> R1(Promotion/Rebate)
                            
                            style F fill:#eab308,stroke:#ca8a04,color:#fff
                    `
                },
                es: {
                    title: 'Segmentación de Clientes',
                    description: 'Estrategias para flotillas vs particular.',
                    content: `
                        <h2>Segmentos de Marketing</h2>
                        <ul class="list-disc pl-5 space-y-2 mt-4 text-slate-300">
                            <li><strong>Particular:</strong> Enfoque en seguridad, confort y facilidad de montaje.</li>
                            <li><strong>Flotilla:</strong> Enfoque en costo-por-kilómetro (CPM), durabilidad y descuento por volumen.</li>
                        </ul>
                    `,
                    workflowDefinition: `
                        graph TD
                            Base[Base Clientes] --> Type{¿Tipo?}
                            Type -->|Flotilla| F[Enfoque Costo]
                            Type -->|Particular| R[Enfoque Seguridad]
                            
                            F --> F1(Desc. Volumen)
                            R --> R1(Promoción/Rebaja)
                            
                            style F fill:#eab308,stroke:#ca8a04,color:#fff
                    `
                }
            }
        ];
    }
}
