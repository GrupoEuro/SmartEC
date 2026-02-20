import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Observable, BehaviorSubject, combineLatest, map, startWith } from 'rxjs';

import { SimulationConfig } from '../components/formula-simulator/formula-simulator.component';

export interface GlossaryTerm {
    id: string;
    term: string;
    definition: string;
    category: 'Metric' | 'Process' | 'Status' | 'Philosophy';
    formula?: string; // HTML for formula display
    formulaExplanation?: { [variable: string]: string }; // Variable breakdown
    visual?: string; // Mermaid definition
    simulationConfig?: SimulationConfig; // New: Interactive Simulation
    relatedTopics?: string[]; // IDs of related HelpTopics
    tags?: string[];
}

@Injectable({
    providedIn: 'root'
})
export class HelpGlossaryService {
    private translate = inject(TranslateService);

    // Initial Glossary Data - Command Center Focus
    // We only keep metadata here. Definitions & Names are now pulled from I18n.
    private readonly rawTerms: GlossaryTerm[] = [
        {
            id: 'gmroi', term: 'GMROI', definition: '', category: 'Metric',
            formula: '\\text{GMROI} = \\frac{\\text{Gross Margin}}{\\text{Avg Inventory Cost}}',
            formulaExplanation: {
                "Gross Margin": "Total Revenue minus Cost of Goods Sold.",
                "Avg Inventory Cost": "Average value of tires in stock."
            },
            tags: ['financial', 'inventory', 'kpi'],
            simulationConfig: {
                variables: [
                    { key: 'margin', label: 'Gross Margin ($)', value: 150000, step: 1000 },
                    { key: 'inventory', label: 'Avg Inventory Cost ($)', value: 50000, step: 1000 }
                ],
                calculate: (vals) => vals['margin'] / vals['inventory'],
                resultLabel: 'GMROI Ratio',
                resultSuffix: '',
                interpretation: (val) => {
                    if (val >= 3.0) return { text: 'Excellent Efficiency', status: 'good' };
                    if (val >= 2.0) return { text: 'Healthy Range', status: 'good' };
                    if (val >= 1.0) return { text: 'Needs Improvement', status: 'warning' };
                    return { text: 'Losing Capital', status: 'bad' };
                }
            }
        },
        {
            id: 'inventory-turnover', term: 'Inventory Turnover Rate', definition: '', category: 'Metric',
            formula: '\\text{Turnover} = \\frac{\\text{COGS}}{\\text{Avg Inventory Value}}',
            formulaExplanation: {
                "COGS": "Cost of tires sold.",
                "Avg Inventory Value": "Average capital tied up in tire stock."
            },
            tags: ['inventory', 'efficiency'],
            visual: `graph LR
                A[Slow Mover<br/>(Chopper/Custom)]:::red
                B[Healthy<br/>(Sport/Touring)]:::green
                C[Fast Mover<br/>(Scooter/Commuter)]:::blue
                
                D(Your Score: 4.5):::pointer
                
                A --- B --- C
                D -.-> B
                
                classDef red fill:#ef4444,stroke:#ef4444,color:#fff
                classDef green fill:#22c55e,stroke:#22c55e,color:#fff
                classDef blue fill:#3b82f6,stroke:#3b82f6,color:#fff
                classDef pointer fill:#f59e0b,stroke:#f59e0b,color:#fff,stroke-width:4px`,
            simulationConfig: {
                variables: [
                    { key: 'cogs', label: 'COGS ($)', value: 200000, step: 5000 },
                    { key: 'avg_inv', label: 'Avg Inventory ($)', value: 50000, step: 1000 }
                ],
                calculate: (vals) => vals['cogs'] / vals['avg_inv'],
                resultLabel: 'Turnover Rate',
                resultSuffix: 'x',
                interpretation: (val) => {
                    if (val >= 4.0) return { text: 'Fast Mover (Moto Standard)', status: 'good' };
                    if (val >= 2.5) return { text: 'Healthy Inventory', status: 'good' };
                    if (val >= 1.0) return { text: 'Slow Moving', status: 'warning' };
                    return { text: 'Dead Stock Risk', status: 'bad' };
                }
            }
        },
        {
            id: 'abc-analysis', term: 'ABC Analysis', definition: '', category: 'Philosophy', tags: ['inventory', 'strategy'],
            visual: `pie title ABC Analysis (Tire Portfolio)
                "A: Premium (Michelin/Pirelli)" : 70
                "B: Mid-Range (Metzeler/Dunlop)" : 20
                "C: Budget/Tube-Type" : 10`
        },
        { id: 'dead-stock', term: 'Dead Stock', definition: '', category: 'Status', relatedTopics: ['inventory-receiving', 'returns-rma'], tags: ['inventory', 'risk'] },
        { id: 'sla', term: 'Service Level Agreement (SLA)', definition: '', category: 'Process', relatedTopics: ['fulfillment-process'], tags: ['operations', 'fulfillment'] },
        {
            id: 'sell-through', term: 'Sell-Through Rate', definition: '', category: 'Metric',
            formula: '\\text{Sell-Through} = \\frac{\\text{Units Sold}}{\\text{Units Sold} + \\text{Units On Hand}} \\times 100',
            formulaExplanation: {
                "Units Sold": "Tires sold in period.",
                "Units On Hand": "Ending tire count."
            },
            tags: ['sales', 'inventory'],
            simulationConfig: {
                variables: [
                    { key: 'sold', label: 'Units Sold', value: 500, step: 10 },
                    { key: 'onHand', label: 'Units On Hand', value: 200, step: 10 }
                ],
                calculate: (vals) => (vals['sold'] / (vals['sold'] + vals['onHand'])) * 100,
                resultLabel: 'Sell-Through Rate',
                resultFormat: 'percent',
                interpretation: (val) => {
                    if (val >= 80) return { text: 'High Demand', status: 'good' };
                    if (val >= 50) return { text: 'Balanced', status: 'good' };
                    if (val >= 30) return { text: 'Overstocked', status: 'warning' };
                    return { text: 'Clearance Needed', status: 'bad' };
                }
            }
        },
        {
            id: 'cagr', term: 'CAGR', definition: '', category: 'Metric',
            formula: '\\text{CAGR} = (\\frac{\\text{Ending Value}}{\\text{Beginning Value}})^{\\frac{1}{n}} - 1',
            formulaExplanation: {
                "Ending Value": "Revenue at end of period.",
                "Beginning Value": "Revenue at start.",
                "n": "Number of years."
            },
            tags: ['financial', 'growth'],
            simulationConfig: {
                variables: [
                    { key: 'end', label: 'Ending Value ($)', value: 150000, step: 1000 },
                    { key: 'start', label: 'Beginning Value ($)', value: 100000, step: 1000 },
                    { key: 'years', label: 'Years (n)', value: 3, step: 1, min: 1 }
                ],
                calculate: (vals) => (Math.pow(vals['end'] / vals['start'], 1 / vals['years']) - 1) * 100,
                resultLabel: 'CAGR',
                resultFormat: 'percent',
                interpretation: (val) => {
                    if (val >= 20) return { text: 'Hyper Growth', status: 'good' };
                    if (val >= 5) return { text: 'Steady Growth', status: 'good' };
                    if (val > 0) return { text: 'Slow Growth', status: 'warning' };
                    return { text: 'Decline', status: 'bad' };
                }
            }
        },
        {
            id: 'stockout-risk', term: 'Stockout Risk', definition: '', category: 'Status', relatedTopics: ['inventory-receiving'], tags: ['inventory', 'risk'],
            formula: 'P(\\text{Stockout}) = P(\\text{Demand} > \\text{Inventory})',
            formulaExplanation: {
                "P": "Probability.",
                "Demand": "Expected sales during lead time."
            }
        },

        // NEW TERMS
        {
            id: 'clv', term: 'CLV', definition: '', category: 'Metric',
            formula: '\\text{CLV} = \\text{AOV} \\times \\text{Freq} \\times \\text{Lifespan}',
            formulaExplanation: {
                "AOV": "Avg Order Value (e.g. Pair F+R).",
                "Freq": "Purchases per year.",
                "Lifespan": "Years active."
            },
            tags: ['sales', 'marketing'],
            simulationConfig: {
                variables: [
                    { key: 'aov', label: 'Avg Order Value ($)', value: 600, step: 50 },
                    { key: 'freq', label: 'Purchases/Year', value: 1.5, step: 0.5 },
                    { key: 'life', label: 'Lifespan (Years)', value: 5, step: 0.5 }
                ],
                calculate: (vals) => vals['aov'] * vals['freq'] * vals['life'],
                resultLabel: 'CLV',
                resultFormat: 'currency'
            }
        },
        {
            id: 'aov', term: 'AOV', definition: '', category: 'Metric',
            formula: '\\text{AOV} = \\frac{\\text{Total Revenue}}{\\text{Total Orders}}',
            formulaExplanation: {
                "Total Revenue": "Gross tire sales.",
                "Total Orders": "Number of transactions."
            },
            tags: ['sales', 'kpi'],
            simulationConfig: {
                variables: [
                    { key: 'revenue', label: 'Total Revenue ($)', value: 50000, step: 1000 },
                    { key: 'orders', label: 'Total Orders', value: 100, step: 5 }
                ],
                calculate: (vals) => vals['orders'] > 0 ? vals['revenue'] / vals['orders'] : 0,
                resultLabel: 'AOV',
                resultFormat: 'currency'
            }
        },
        {
            id: 'conversion-rate', term: 'Conversion Rate', definition: '', category: 'Metric',
            formula: '\\text{Conv Rate} = \\frac{\\text{Orders}}{\\text{Visitors}} \\times 100',
            formulaExplanation: {
                "Orders": "Completed tire purchases.",
                "Visitors": "Website sessions."
            },
            tags: ['sales', 'marketing'],
            simulationConfig: {
                variables: [
                    { key: 'conversions', label: 'Orders', value: 45, step: 1 },
                    { key: 'visitors', label: 'Visitors', value: 1200, step: 50 }
                ],
                calculate: (vals) => vals['visitors'] > 0 ? (vals['conversions'] / vals['visitors']) * 100 : 0,
                resultLabel: 'Conv. Rate',
                resultFormat: 'percent',
                interpretation: (val) => {
                    if (val >= 3.0) return { text: 'Top Performer', status: 'good' };
                    if (val >= 1.5) return { text: 'Average', status: 'warning' };
                    return { text: 'Conversion Issue', status: 'bad' };
                }
            }
        },
        {
            id: 'ebitda', term: 'EBITDA', definition: '', category: 'Metric', tags: ['financial'],
            formula: '\\text{EBITDA} = \\text{Net Income} + \\text{Interest} + \\text{Taxes} + \\text{D} + \\text{A}',
            formulaExplanation: {
                "D": "Depreciation.",
                "A": "Amortization."
            }
        },
        {
            id: 'safety-stock', term: 'Safety Stock', definition: '', category: 'Status',
            formula: '\\text{Safety Stock} = (\\text{Max Lead} \\times \\text{Max Usage}) - (\\text{Avg Lead} \\times \\text{Avg Usage})',
            formulaExplanation: {
                "Max Lead": "Longest delivery time from supplier.",
                "Max Usage": "Peak daily sales.",
                "Avg Lead": "Typical delivery time."
            },
            relatedTopics: ['inventory-receiving'], tags: ['inventory', 'planning'],
            simulationConfig: {
                variables: [
                    { key: 'maxLead', label: 'Max Lead (days)', value: 14, step: 1 },
                    { key: 'maxUsage', label: 'Max Daily Usage', value: 50, step: 5 },
                    { key: 'avgLead', label: 'Avg Lead (days)', value: 7, step: 1 },
                    { key: 'avgUsage', label: 'Avg Daily Usage', value: 30, step: 5 }
                ],
                calculate: (vals) => (vals['maxLead'] * vals['maxUsage']) - (vals['avgLead'] * vals['avgUsage']),
                resultLabel: 'Safety Stock',
                resultSuffix: 'tires'
            }
        },
        { id: 'lead-time', term: 'Lead Time', definition: '', category: 'Process', relatedTopics: ['fulfillment-process', 'inventory-receiving'], tags: ['operations', 'logistics'] },
        {
            id: 'perfect-order', term: 'Perfect Order Rate', definition: '', category: 'Metric', relatedTopics: ['fulfillment-process', 'returns-rma'], tags: ['operations', 'quality'],
            formula: '\\text{Perfect Rate} = (\\frac{\\text{Total Orders} - \\text{Errors}}{\\text{Total Orders}}) \\times 100',
            formulaExplanation: {
                "Errors": "Returns, damages, or late shipments."
            }
        },

        {
            id: 'cac', term: 'CAC', definition: '', category: 'Metric',
            formula: '\\text{CAC} = \\frac{\\text{Marketing Spend}}{\\text{New Customers}}',
            formulaExplanation: {
                "Marketing Spend": "Ads, SEO, Team costs.",
                "New Customers": "First-time tire buyers."
            },
            tags: ['sales', 'marketing', 'financial'],
            simulationConfig: {
                variables: [
                    { key: 'spend', label: 'Marketing Spend ($)', value: 10000, step: 500 },
                    { key: 'newCust', label: 'New Customers', value: 200, step: 10 }
                ],
                calculate: (vals) => vals['newCust'] > 0 ? vals['spend'] / vals['newCust'] : 0,
                resultLabel: 'CAC',
                resultFormat: 'currency'
            }
        },
        {
            id: 'churn-rate', term: 'Churn Rate', definition: '', category: 'Metric',
            formula: '\\text{Churn} = (\\frac{\\text{Lost Customers}}{\\text{Start Customers}}) \\times 100',
            tags: ['sales', 'retention'],
            visual: `pie title Churn (Fleet Customers)
                "Active Fleets" : 92
                "Lost to Competitor" : 3
                "Fleet Downsized" : 5`,
            simulationConfig: {
                variables: [
                    { key: 'lost', label: 'Lost Customers', value: 50, step: 5 },
                    { key: 'start', label: 'Start Customers', value: 1000, step: 50 }
                ],
                calculate: (vals) => vals['start'] > 0 ? (vals['lost'] / vals['start']) * 100 : 0,
                resultLabel: 'Churn Rate',
                resultFormat: 'percent'
            }
        },
        {
            id: 'nps', term: 'NPS', definition: '', category: 'Metric',
            formula: '\\text{NPS} = \\%\\text{Promoters} - \\%\\text{Detractors}',
            tags: ['customer', 'satisfaction'],
            simulationConfig: {
                variables: [
                    { key: 'promoters', label: 'Promoters (%)', value: 60, step: 5, min: 0, max: 100 },
                    { key: 'detractors', label: 'Detractors (%)', value: 20, step: 5, min: 0, max: 100 }
                ],
                calculate: (vals) => vals['promoters'] - vals['detractors'],
                resultLabel: 'NPS',
                resultSuffix: '',
                interpretation: (val) => {
                    if (val >= 70) return { text: 'World Class', status: 'good' };
                    if (val >= 30) return { text: 'Great', status: 'good' };
                    if (val >= 0) return { text: 'Good', status: 'warning' };
                    return { text: 'Needs Attention', status: 'bad' };
                }
            }
        },
        {
            id: 'cart-abandonment', term: 'Cart Abandonment Rate', definition: '', category: 'Metric',
            formula: '\\text{Abandonment} = \\frac{\\text{Created} - \\text{Completed}}{\\text{Created}} \\times 100',
            tags: ['sales', 'conversion'],
            simulationConfig: {
                variables: [
                    { key: 'created', label: 'Carts Created', value: 500, step: 10 },
                    { key: 'completed', label: 'Completed Orders', value: 350, step: 10 }
                ],
                calculate: (vals) => vals['created'] > 0 ? ((vals['created'] - vals['completed']) / vals['created']) * 100 : 0,
                resultLabel: 'Abandonment Rate',
                resultFormat: 'percent'
            }
        },
        {
            id: 'cohort-analysis', term: 'Cohort Analysis', definition: '', category: 'Philosophy', tags: ['analytics', 'behavior'],
            visual: `
                gantt
                title Winter Tire Retention
                dateFormat  YYYY-MM-DD
                section Nov Cohort
                Purchase :active, 2024-11-01, 30d
                Spring Changeover : 2025-04-01, 30d
                Next Winter :       2025-11-01, 30d
        `},
        {
            id: 'ltv-cac', term: 'LTV:CAC Ratio', definition: '', category: 'Metric',
            formula: '\\text{Ratio} = \\frac{\\text{CLV}}{\\text{CAC}}',
            tags: ['financial', 'strategic'],
            simulationConfig: {
                variables: [
                    { key: 'clv', label: 'CLV ($)', value: 1800, step: 100 },
                    { key: 'cac', label: 'CAC ($)', value: 600, step: 50 }
                ],
                calculate: (vals) => vals['cac'] > 0 ? vals['clv'] / vals['cac'] : 0,
                resultLabel: 'LTV:CAC Ratio',
                resultSuffix: ':1'
            }
        },

        {
            id: 'eoq', term: 'EOQ', definition: '', category: 'Metric',
            formula: '\\text{EOQ} = \\sqrt{\\frac{2 \\times \\text{Demand} \\times \\text{Order Cost}}{\\text{Holding Cost}}}',
            formulaExplanation: {
                "Demand": "Annual tire demand.",
                "Order Cost": "Cost per container/shipment.",
                "Holding Cost": "Cost to store one tire/year."
            },
            tags: ['inventory', 'efficiency'],
            simulationConfig: {
                variables: [
                    { key: 'demand', label: 'Annual Demand', value: 10000, step: 500 },
                    { key: 'orderCost', label: 'Order Cost ($)', value: 50, step: 5 },
                    { key: 'holdingCost', label: 'Holding Cost/Unit ($)', value: 2, step: 0.5 }
                ],
                calculate: (vals) => vals['holdingCost'] > 0 ? Math.sqrt((2 * vals['demand'] * vals['orderCost']) / vals['holdingCost']) : 0,
                resultLabel: 'EOQ',
                resultSuffix: 'tires'
            }
        },
        {
            id: 'rfm', term: 'RFM Assessment', definition: '', category: 'Metric', tags: ['sales', 'marketing'],
            formula: '\\text{Score} = \\text{Recency} + \\text{Frequency} + \\text{Monetary}',
            formulaExplanation: {
                "Recency": "Days since last purchase.",
                "Frequency": "Total number of purchases.",
                "Monetary": "Total spent."
            }
        },
        {
            id: 'slotting', term: 'Slotting', definition: '', category: 'Process', relatedTopics: ['operational-excellence'], tags: ['operations', 'warehouse']
        },
        {
            id: 'cross-docking', term: 'Cross-Docking', definition: '', category: 'Process', relatedTopics: ['operational-excellence'], tags: ['operations', 'logistics'],
            visual: `flowchart LR
                A[Factory Container] --> B{Dock}
                B -->|Direct Transload| C[Delivery Van]
                B -.->|Storage (Avoid)| D[Racking]`
        },
        {
            id: 'pareto', term: 'Pareto Principle (80/20)', definition: '', category: 'Philosophy', tags: ['strategy', 'analysis'],
            visual: `pie title Revenue by Size (Pareto)
                "Top 20% Sizes (e.g 120/70-17)" : 80
                "Other 80% Sizes" : 20`
        },
        {
            id: 'cannibalization', term: 'Cannibalization', definition: '', category: 'Status', tags: ['sales', 'product'],
            visual: `graph TD
                A[Legacy Model (Pilot Road 4)]:::existing
                B[New Model (Road 6)]:::new
                
                A --- C((Target Audience)):::cannibal
                B --- C
                
                classDef existing fill:#1e293b,stroke:#94a3b8,color:#fff
                classDef new fill:#0f766e,stroke:#2dd4bf,color:#fff
                classDef cannibal fill:#ef4444,stroke:#ef4444,color:#fff`
        }
    ];

    constructor() { }

    getTerms(): Observable<GlossaryTerm[]> {
        return this.translate.onLangChange.pipe(
            startWith({ lang: this.translate.currentLang || 'en' }),
            map(() => {
                return this.rawTerms.map(term => {
                    // Look up translation based on ID mapping
                    // IDs like 'abc-analysis' map to 'GLOSSARY.TERMS.ABC_ANALYSIS'
                    const key = term.id.replace(/-/g, '_').toUpperCase();

                    // Allow specific overrides if ID doesn't match key perfectly
                    const finalKey = key === 'GMROI' ? 'GMROI' :
                        key === 'INVENTORY_TURNOVER' ? 'INV_TURNOVER' :
                            key;

                    return {
                        ...term,
                        term: this.translate.instant(`GLOSSARY.TERMS.${finalKey}.TERM`) || term.term,
                        definition: this.translate.instant(`GLOSSARY.TERMS.${finalKey}.DEF`) || term.definition,
                        // Try to get translated formula, fallback to existing
                        formula: this.translate.instant(`GLOSSARY.TERMS.${finalKey}.FORMULA`) !== `GLOSSARY.TERMS.${finalKey}.FORMULA`
                            ? this.translate.instant(`GLOSSARY.TERMS.${finalKey}.FORMULA`)
                            : term.formula
                    };
                });
            })
        );
    }

    searchTerms(query: string): Observable<GlossaryTerm[]> {
        return this.getTerms().pipe(
            map(terms => {
                const lowerQ = query.toLowerCase();
                return terms.filter(t =>
                    t.term.toLowerCase().includes(lowerQ) ||
                    t.definition.toLowerCase().includes(lowerQ) ||
                    t.tags?.some(tag => tag.toLowerCase().includes(lowerQ))
                );
            })
        );
    }

    getTermsByCategory(category: string): Observable<GlossaryTerm[]> {
        return this.getTerms().pipe(
            map(terms => category === 'All' ? terms : terms.filter(t => t.category === category))
        );
    }
}
