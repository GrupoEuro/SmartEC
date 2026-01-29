import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    doc,
    setDoc,
    Timestamp
} from '@angular/fire/firestore';
import { ProductTypeTemplate } from '../models/catalog.model';

/**
 * System Template Seeder Service
 * Seeds initial product type templates (tire, helmet, battery, part, accessory) to Firestore
 */
@Injectable({
    providedIn: 'root'
})
export class ProductTypeSeederService {
    private firestore = inject(Firestore);

    /**
     * Seed all system product type templates to Firestore
     */
    async seedSystemTemplates(): Promise<void> {
        const templates: ProductTypeTemplate[] = [
            this.createTireTemplate(),
            this.createHelmetTemplate(),
            this.createBatteryTemplate(),
            this.createPartTemplate(),
            this.createAccessoryTemplate()
        ];

        try {
            for (const template of templates) {
                await this.saveTemplate(template);
            }
            console.log('✅ Successfully seeded all system product type templates');
        } catch (error) {
            console.error('❌ Error seeding templates:', error);
            throw error;
        }
    }

    /**
     * Save a single template to Firestore
     */
    private async saveTemplate(template: ProductTypeTemplate): Promise<void> {
        const templateDoc = doc(this.firestore, 'productTypeTemplates', template.id);
        await setDoc(templateDoc, {
            ...template,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        });
        console.log(`✓ Seeded template: ${template.name.en}`);
    }

    /**
     * Create tire template
     */
    private createTireTemplate(): ProductTypeTemplate {
        return {
            id: 'tire',
            name: { es: 'Neumático', en: 'Tire' },
            icon: '🛞',
            description: {
                es: 'Neumáticos para motocicletas',
                en: 'Motorcycle tires'
            },
            isSystem: true,
            active: true,
            version: 1,
            schema: [
                {
                    id: 'width',
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
                    id: 'aspectRatio',
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
                    id: 'diameter',
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
                    id: 'loadIndex',
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
                    id: 'speedRating',
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
                    id: 'construction',
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
                    id: 'tubeless',
                    key: 'tubeless',
                    label: { es: 'Sin Cámara', en: 'Tubeless' },
                    type: 'boolean',
                    required: true,
                    searchable: true,
                    filterable: true,
                    displayOrder: 7
                }
            ],
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    /**
     * Create helmet template
     */
    private createHelmetTemplate(): ProductTypeTemplate {
        return {
            id: 'helmet',
            name: { es: 'Casco', en: 'Helmet' },
            icon: '🪖',
            description: {
                es: 'Cascos de seguridad para motocicletas',
                en: 'Motorcycle safety helmets'
            },
            isSystem: true,
            active: true,
            version: 1,
            schema: [
                {
                    id: 'size',
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
                    id: 'type',
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
                    id: 'certifications',
                    key: 'certifications',
                    label: { es: 'Certificaciones de Seguridad', en: 'Safety Certifications' },
                    type: 'text',
                    required: true,
                    searchable: true,
                    filterable: false,
                    displayOrder: 3
                },
                {
                    id: 'shellMaterial',
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
                    id: 'weight',
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
                    id: 'visorType',
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
                    id: 'ventilation',
                    key: 'ventilation',
                    label: { es: 'Ventilación', en: 'Ventilation' },
                    type: 'text',
                    required: false,
                    searchable: false,
                    filterable: false,
                    displayOrder: 7
                }
            ],
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    /**
     * Create battery template
     */
    private createBatteryTemplate(): ProductTypeTemplate {
        return {
            id: 'battery',
            name: { es: 'Batería', en: 'Battery' },
            icon: '🔋',
            description: {
                es: 'Baterías para motocicletas',
                en: 'Motorcycle batteries'
            },
            isSystem: true,
            active: true,
            version: 1,
            schema: [
                {
                    id: 'voltage',
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
                    id: 'capacity',
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
                    id: 'cca',
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
                    id: 'batteryType',
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
                    id: 'dimensions',
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
                    id: 'terminalType',
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
                    id: 'polarity',
                    key: 'polarity',
                    label: { es: 'Polaridad', en: 'Polarity' },
                    type: 'select',
                    required: false,
                    options: ['positive-left', 'positive-right'],
                    searchable: false,
                    filterable: false,
                    displayOrder: 7
                }
            ],
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    /**
     * Create motorcycle part template
     */
    private createPartTemplate(): ProductTypeTemplate {
        return {
            id: 'part',
            name: { es: 'Repuesto', en: 'Part' },
            icon: '🔧',
            description: {
                es: 'Repuestos y piezas para motocicletas',
                en: 'Motorcycle parts and components'
            },
            isSystem: true,
            active: true,
            version: 1,
            schema: [
                {
                    id: 'partType',
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
                    id: 'compatibility',
                    key: 'compatibility',
                    label: { es: 'Compatibilidad', en: 'Compatibility' },
                    type: 'text',
                    required: false,
                    searchable: true,
                    filterable: false,
                    displayOrder: 2
                },
                {
                    id: 'material',
                    key: 'material',
                    label: { es: 'Material', en: 'Material' },
                    type: 'text',
                    required: false,
                    searchable: true,
                    filterable: false,
                    displayOrder: 3
                },
                {
                    id: 'oemNumber',
                    key: 'oemNumber',
                    label: { es: 'Número OEM', en: 'OEM Number' },
                    type: 'text',
                    required: false,
                    searchable: true,
                    filterable: false,
                    displayOrder: 4
                },
                {
                    id: 'dimensions',
                    key: 'dimensions',
                    label: { es: 'Dimensiones', en: 'Dimensions' },
                    type: 'text',
                    required: false,
                    searchable: false,
                    filterable: false,
                    displayOrder: 5
                },
                {
                    id: 'color',
                    key: 'color',
                    label: { es: 'Color', en: 'Color' },
                    type: 'text',
                    required: false,
                    searchable: false,
                    filterable: false,
                    displayOrder: 6
                }
            ],
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    /**
     * Create accessory template
     */
    private createAccessoryTemplate(): ProductTypeTemplate {
        return {
            id: 'accessory',
            name: { es: 'Accesorio', en: 'Accessory' },
            icon: '🎒',
            description: {
                es: 'Accesorios para motocicletas y motociclistas',
                en: 'Motorcycle and rider accessories'
            },
            isSystem: true,
            active: true,
            version: 1,
            schema: [
                {
                    id: 'accessoryType',
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
                    id: 'size',
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
                    id: 'material',
                    key: 'material',
                    label: { es: 'Material', en: 'Material' },
                    type: 'text',
                    required: false,
                    searchable: true,
                    filterable: false,
                    displayOrder: 3
                },
                {
                    id: 'color',
                    key: 'color',
                    label: { es: 'Color', en: 'Color' },
                    type: 'text',
                    required: false,
                    searchable: false,
                    filterable: false,
                    displayOrder: 4
                },
                {
                    id: 'waterproof',
                    key: 'waterproof',
                    label: { es: 'Impermeable', en: 'Waterproof' },
                    type: 'boolean',
                    required: false,
                    searchable: false,
                    filterable: true,
                    displayOrder: 5
                }
            ],
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }
}
