import { Injectable, inject } from '@angular/core';
import { Firestore, collection, onSnapshot, query, where, orderBy } from '@angular/fire/firestore';
import { BehaviorSubject, Observable } from 'rxjs';
import { ProductType, ProductTypeDefinition, ProductTypeTemplate, SpecificationField } from '../models/catalog.model';

/**
 * Product Type Configuration Service
 * 
 * Manages product type definitions and their specification schemas.
 * Loads templates from Firestore for dynamic product type management.
 * Falls back to hardcoded system types if Firestore is unavailable.
 */
@Injectable({
    providedIn: 'root'
})
export class ProductTypeConfigService {
    private firestore = inject(Firestore);

    private productTypes: Map<ProductType, ProductTypeDefinition> = new Map();
    private templatesLoaded = false;

    // Observable stream of product type definitions
    private templatesSubject = new BehaviorSubject<ProductTypeDefinition[]>([]);
    public templates$ = this.templatesSubject.asObservable();

    constructor() {
        this.initializeProductTypes();
        this.subscribeToTemplateChanges();
    }

    /**
     * Initialize product types - load from Firestore or use hardcoded fallback
     */
    private async initializeProductTypes(): Promise<void> {
        // First, load hardcoded system types as fallback
        this.loadSystemTypes();
        this.emitTemplates();

        // Then attempt to load from Firestore (will update when data arrives)
        // subscribeToTemplateChanges() handles this
    }

    /**
     * Subscribe to real-time template changes in Firestore
     */
    private subscribeToTemplateChanges(): void {
        try {
            const templatesRef = collection(this.firestore, 'productTypeTemplates');
            const q = query(
                templatesRef,
                where('active', '==', true),
                orderBy('name.en')
            );

            onSnapshot(q,
                (snapshot) => {
                    this.productTypes.clear();

                    snapshot.docs.forEach(doc => {
                        const template = {
                            ...doc.data(),
                            id: doc.id
                        } as ProductTypeTemplate;

                        const definition: ProductTypeDefinition = {
                            id: template.id as ProductType,
                            name: template.name,
                            icon: template.icon,
                            specificationSchema: template.schema
                        };

                        this.productTypes.set(definition.id, definition);
                    });

                    this.templatesLoaded = true;
                    this.emitTemplates();
                },
                (error) => {
                    console.error('Error subscribing to product type templates:', error);
                    // Keep using system types on error
                    if (!this.templatesLoaded) {
                        this.loadSystemTypes();
                        this.emitTemplates();
                    }
                }
            );
        } catch (error) {
            console.error('Error setting up Firestore subscription:', error);
            // Fall back to system types
            this.loadSystemTypes();
            this.emitTemplates();
        }
    }

    /**
     * Emit current templates to subscribers
     */
    private emitTemplates(): void {
        const templates = Array.from(this.productTypes.values());
        this.templatesSubject.next(templates);
    }

    /**
     * Load hardcoded system types (fallback and initial load)
     */
    private loadSystemTypes(): void {
        this.initializeTireType();
        this.initializeHelmetType();
        this.initializeBatteryType();
        this.initializePartType();
        this.initializeAccessoryType();
    }

    /**
     * TIRE Product Type Configuration
     */
    private initializeTireType(): void {
        this.productTypes.set('tire', {
            id: 'tire',
            name: { es: 'Neumático', en: 'Tire' },
            icon: '🛞',
            specificationSchema: [
                {
                    key: 'width',
                    label: { es: 'Ancho', en: 'Width' },
                    type: 'select',
                    required: true,
                    unit: 'mm',
                    options: ['80', '90', '100', '110', '120', '130', '140', '150', '160', '170', '180', '190', '200'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 1
                },
                {
                    key: 'aspectRatio',
                    label: { es: 'Perfil', en: 'Aspect Ratio' },
                    type: 'select',
                    required: true,
                    unit: '%',
                    options: ['50', '55', '60', '65', '70', '75', '80', '90'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 2
                },
                {
                    key: 'diameter',
                    label: { es: 'Diámetro', en: 'Diameter' },
                    type: 'select',
                    required: true,
                    unit: 'inches',
                    options: ['10', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 3
                },
                {
                    key: 'loadIndex',
                    label: { es: 'Índice de Carga', en: 'Load Index' },
                    type: 'select',
                    required: true,
                    options: ['51', '54', '57', '58', '59', '60', '62', '65', '69', '73', '75', '80'],
                    searchable: true,
                    filterable: false,
                    displayOrder: 4
                },
                {
                    key: 'speedRating',
                    label: { es: 'Índice de Velocidad', en: 'Speed Rating' },
                    type: 'select',
                    required: true,
                    options: ['H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'Y', 'Z'],
                    searchable: true,
                    filterable: false,
                    displayOrder: 5
                },
                {
                    key: 'construction',
                    label: { es: 'Construcción', en: 'Construction' },
                    type: 'select',
                    required: true,
                    options: ['radial', 'bias'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 6
                },
                {
                    key: 'tubeless',
                    label: { es: 'Sin Cámara', en: 'Tubeless' },
                    type: 'boolean',
                    required: true,
                    searchable: true,
                    filterable: true,
                    displayOrder: 7
                }
            ]
        });
    }

    /**
     * HELMET Product Type Configuration
     */
    private initializeHelmetType(): void {
        this.productTypes.set('helmet', {
            id: 'helmet',
            name: { es: 'Casco', en: 'Helmet' },
            icon: '🪖',
            specificationSchema: [
                {
                    key: 'size',
                    label: { es: 'Talla', en: 'Size' },
                    type: 'select',
                    required: true,
                    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 1
                },
                {
                    key: 'type',
                    label: { es: 'Tipo', en: 'Type' },
                    type: 'select',
                    required: true,
                    options: ['full-face', 'modular', 'open-face', 'off-road', 'half-helmet'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 2
                },
                {
                    key: 'certifications',
                    label: { es: 'Certificaciones de Seguridad', en: 'Safety Certifications' },
                    type: 'text',
                    required: true,
                    searchable: true,
                    filterable: false,
                    displayOrder: 3
                },
                {
                    key: 'shellMaterial',
                    label: { es: 'Material del Casco', en: 'Shell Material' },
                    type: 'select',
                    required: false,
                    options: ['polycarbonate', 'fiberglass', 'carbon-fiber', 'ABS', 'composite'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 4
                },
                {
                    key: 'weight',
                    label: { es: 'Peso', en: 'Weight' },
                    type: 'number',
                    required: false,
                    unit: 'g',
                    min: 500,
                    max: 2500,
                    searchable: false,
                    filterable: false,
                    displayOrder: 5
                },
                {
                    key: 'visorType',
                    label: { es: 'Tipo de Visor', en: 'Visor Type' },
                    type: 'select',
                    required: false,
                    options: ['clear', 'tinted', 'photochromic', 'pinlock-ready', 'anti-fog'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 6
                },
                {
                    key: 'ventilation',
                    label: { es: 'Ventilación', en: 'Ventilation' },
                    type: 'text',
                    required: false,
                    searchable: false,
                    filterable: false,
                    displayOrder: 7
                }
            ]
        });
    }

    /**
     * BATTERY Product Type Configuration
     */
    private initializeBatteryType(): void {
        this.productTypes.set('battery', {
            id: 'battery',
            name: { es: 'Batería', en: 'Battery' },
            icon: '🔋',
            specificationSchema: [
                {
                    key: 'voltage',
                    label: { es: 'Voltaje', en: 'Voltage' },
                    type: 'select',
                    required: true,
                    unit: 'V',
                    options: ['6', '12'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 1
                },
                {
                    key: 'capacity',
                    label: { es: 'Capacidad', en: 'Capacity' },
                    type: 'number',
                    required: true,
                    unit: 'Ah',
                    min: 2,
                    max: 30,
                    searchable: true,
                    filterable: false,
                    displayOrder: 2
                },
                {
                    key: 'cca',
                    label: { es: 'Corriente de Arranque en Frío', en: 'Cold Cranking Amps' },
                    type: 'number',
                    required: false,
                    unit: 'A',
                    min: 50,
                    max: 500,
                    searchable: false,
                    filterable: false,
                    displayOrder: 3
                },
                {
                    key: 'batteryType',
                    label: { es: 'Tipo de Batería', en: 'Battery Type' },
                    type: 'select',
                    required: true,
                    options: ['lead-acid', 'AGM', 'gel', 'lithium', 'lithium-ion'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 4
                },
                {
                    key: 'dimensions',
                    label: { es: 'Dimensiones (L x W x H)', en: 'Dimensions (L x W x H)' },
                    type: 'text',
                    required: false,
                    unit: 'mm',
                    searchable: false,
                    filterable: false,
                    displayOrder: 5
                },
                {
                    key: 'terminalType',
                    label: { es: 'Tipo de Terminal', en: 'Terminal Type' },
                    type: 'select',
                    required: false,
                    options: ['standard', 'screw', 'bolt', 'threaded'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 6
                },
                {
                    key: 'polarity',
                    label: { es: 'Polaridad', en: 'Polarity' },
                    type: 'select',
                    required: false,
                    options: ['positive-left', 'positive-right'],
                    searchable: false,
                    filterable: false,
                    displayOrder: 7
                }
            ]
        });
    }

    /**
     * PART (Motorcycle Parts) Product Type Configuration
     */
    private initializePartType(): void {
        this.productTypes.set('part', {
            id: 'part',
            name: { es: 'Repuesto', en: 'Part' },
            icon: '🔧',
            specificationSchema: [
                {
                    key: 'partType',
                    label: { es: 'Tipo de Repuesto', en: 'Part Type' },
                    type: 'select',
                    required: true,
                    options: ['brake-pad', 'chain', 'sprocket', 'filter', 'cable', 'spark-plug', 'clutch', 'bearing', 'gasket', 'other'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 1
                },
                {
                    key: 'compatibility',
                    label: { es: 'Compatibilidad', en: 'Compatibility' },
                    type: 'text',
                    required: false,
                    searchable: true,
                    filterable: false,
                    displayOrder: 2
                },
                {
                    key: 'material',
                    label: { es: 'Material', en: 'Material' },
                    type: 'text',
                    required: false,
                    searchable: true,
                    filterable: false,
                    displayOrder: 3
                },
                {
                    key: 'oemNumber',
                    label: { es: 'Número OEM', en: 'OEM Number' },
                    type: 'text',
                    required: false,
                    searchable: true,
                    filterable: false,
                    displayOrder: 4
                },
                {
                    key: 'dimensions',
                    label: { es: 'Dimensiones', en: 'Dimensions' },
                    type: 'text',
                    required: false,
                    searchable: false,
                    filterable: false,
                    displayOrder: 5
                },
                {
                    key: 'color',
                    label: { es: 'Color', en: 'Color' },
                    type: 'text',
                    required: false,
                    searchable: false,
                    filterable: false,
                    displayOrder: 6
                }
            ]
        });
    }

    /**
     * ACCESSORY Product Type Configuration
     */
    private initializeAccessoryType(): void {
        this.productTypes.set('accessory', {
            id: 'accessory',
            name: { es: 'Accesorio', en: 'Accessory' },
            icon: '🎒',
            specificationSchema: [
                {
                    key: 'accessoryType',
                    label: { es: 'Tipo de Accesorio', en: 'Accessory Type' },
                    type: 'select',
                    required: true,
                    options: ['gloves', 'jacket', 'pants', 'boots', 'bag', 'lock', 'cover', 'tool-kit', 'other'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 1
                },
                {
                    key: 'size',
                    label: { es: 'Talla', en: 'Size' },
                    type: 'select',
                    required: false,
                    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One-Size'],
                    searchable: true,
                    filterable: true,
                    displayOrder: 2
                },
                {
                    key: 'material',
                    label: { es: 'Material', en: 'Material' },
                    type: 'text',
                    required: false,
                    searchable: true,
                    filterable: false,
                    displayOrder: 3
                },
                {
                    key: 'color',
                    label: { es: 'Color', en: 'Color' },
                    type: 'text',
                    required: false,
                    searchable: false,
                    filterable: false,
                    displayOrder: 4
                },
                {
                    key: 'waterproof',
                    label: { es: 'Impermeable', en: 'Waterproof' },
                    type: 'boolean',
                    required: false,
                    searchable: false,
                    filterable: true,
                    displayOrder: 5
                }
            ]
        });
    }

    /**
     * Get product type definition by ID
     */
    getProductType(type: ProductType): ProductTypeDefinition | undefined {
        return this.productTypes.get(type);
    }

    /**
     * Get all available product types
     */
    getAllProductTypes(): ProductTypeDefinition[] {
        return Array.from(this.productTypes.values());
    }

    /**
     * Get specification schema for a product type
     */
    getSpecificationSchema(type: ProductType): SpecificationField[] {
        return this.productTypes.get(type)?.specificationSchema || [];
    }

    /**
     * Get required fields for a product type
     */
    getRequiredFields(type: ProductType): string[] {
        const schema = this.getSpecificationSchema(type);
        return schema.filter(field => field.required).map(field => field.key);
    }

    /**
     * Get filterable fields for a product type (for catalog filtering)
     */
    getFilterableFields(type: ProductType): SpecificationField[] {
        const schema = this.getSpecificationSchema(type);
        return schema.filter(field => field.filterable);
    }

    /**
     * Get searchable fields for a product type (for search indexing)
     */
    getSearchableFields(type: ProductType): SpecificationField[] {
        const schema = this.getSpecificationSchema(type);
        return schema.filter(field => field.searchable);
    }
}
