import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    Timestamp
} from '@angular/fire/firestore';
import { ProductTypeTemplate } from '../models/catalog.model';

/**
 * Service for managing Product Type Templates in Firestore
 * Handles CRUD operations for dynamic product type schemas
 */
@Injectable({
    providedIn: 'root'
})
export class ProductTypeTemplateService {
    private firestore = inject(Firestore);
    private readonly COLLECTION = 'productTypeTemplates';

    /**
     * Get all product type templates
     */
    async getAllTemplates(): Promise<ProductTypeTemplate[]> {
        try {
            const templatesRef = collection(this.firestore, this.COLLECTION);
            const q = query(templatesRef, orderBy('name.en'));
            const snapshot = await getDocs(q);

            return snapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                createdAt: doc.data()['createdAt']?.toDate() || new Date(),
                updatedAt: doc.data()['updatedAt']?.toDate() || new Date()
            })) as ProductTypeTemplate[];
        } catch (error) {
            console.error('Error fetching templates:', error);
            throw error;
        }
    }

    /**
     * Get active templates only (shown in product form)
     */
    async getActiveTemplates(): Promise<ProductTypeTemplate[]> {
        try {
            const templatesRef = collection(this.firestore, this.COLLECTION);
            const q = query(
                templatesRef,
                where('active', '==', true),
                orderBy('name.en')
            );
            const snapshot = await getDocs(q);

            return snapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                createdAt: doc.data()['createdAt']?.toDate() || new Date(),
                updatedAt: doc.data()['updatedAt']?.toDate() || new Date()
            })) as ProductTypeTemplate[];
        } catch (error) {
            console.error('Error fetching active templates:', error);
            throw error;
        }
    }

    /**
     * Get template by ID
     */
    async getTemplateById(id: string): Promise<ProductTypeTemplate | null> {
        try {
            const templateDoc = doc(this.firestore, this.COLLECTION, id);
            const snapshot = await getDoc(templateDoc);

            if (!snapshot.exists()) {
                return null;
            }

            return {
                ...snapshot.data(),
                id: snapshot.id,
                createdAt: snapshot.data()['createdAt']?.toDate() || new Date(),
                updatedAt: snapshot.data()['updatedAt']?.toDate() || new Date()
            } as ProductTypeTemplate;
        } catch (error) {
            console.error('Error fetching template:', error);
            throw error;
        }
    }

    /**
     * Create new product type template
     */
    async createTemplate(
        template: Omit<ProductTypeTemplate, 'createdAt' | 'updatedAt'>
    ): Promise<string> {
        try {
            // Validate template ID
            this.validateTemplateId(template.id);

            // Check if template with this ID already exists
            const existing = await this.getTemplateById(template.id);
            if (existing) {
                throw new Error(`Template with ID '${template.id}' already exists`);
            }

            // Validate template data
            this.validateTemplate(template);

            const templateData: any = {
                ...template,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            };

            const templateDoc = doc(this.firestore, this.COLLECTION, template.id);
            await setDoc(templateDoc, templateData);

            return template.id;
        } catch (error) {
            console.error('Error creating template:', error);
            throw error;
        }
    }

    /**
     * Update existing template
     */
    async updateTemplate(
        id: string,
        updates: Partial<Omit<ProductTypeTemplate, 'id' | 'createdAt' | 'updatedAt'>>
    ): Promise<void> {
        try {
            // Check if template exists
            const existing = await this.getTemplateById(id);
            if (!existing) {
                throw new Error(`Template '${id}' not found`);
            }

            // If updating schema, validate it
            if (updates.schema) {
                this.validateSchema(updates.schema);
            }

            const updateData: any = {
                ...updates,
                updatedAt: Timestamp.now()
            };

            const templateDoc = doc(this.firestore, this.COLLECTION, id);
            await updateDoc(templateDoc, updateData);
        } catch (error) {
            console.error('Error updating template:', error);
            throw error;
        }
    }

    /**
     * Delete template (with safety checks)
     */
    async deleteTemplate(id: string): Promise<void> {
        try {
            // Check if template exists
            const template = await this.getTemplateById(id);
            if (!template) {
                throw new Error(`Template '${id}' not found`);
            }

            // Prevent deletion of system templates
            if (template.isSystem) {
                throw new Error('Cannot delete system templates. System templates are protected.');
            }

            // Check if any products are using this template
            const productsUsingTemplate = await this.checkProductsUsingTemplate(id);
            if (productsUsingTemplate > 0) {
                throw new Error(
                    `Cannot delete template. ${productsUsingTemplate} product(s) are using this product type. ` +
                    `Please reassign or delete those products first.`
                );
            }

            // Safe to delete
            const templateDoc = doc(this.firestore, this.COLLECTION, id);
            await deleteDoc(templateDoc);
        } catch (error) {
            console.error('Error deleting template:', error);
            throw error;
        }
    }

    /**
     * Toggle template active status
     */
    async toggleActive(id: string, active: boolean): Promise<void> {
        try {
            await this.updateTemplate(id, { active });
        } catch (error) {
            console.error('Error toggling template active status:', error);
            throw error;
        }
    }

    /**
     * Duplicate template with new ID and name
     */
    async duplicateTemplate(sourceId: string, newId: string, newName: { es: string; en: string }): Promise<string> {
        try {
            // Get source template
            const source = await this.getTemplateById(sourceId);
            if (!source) {
                throw new Error(`Source template '${sourceId}' not found`);
            }

            // Create duplicate
            const duplicate: Omit<ProductTypeTemplate, 'createdAt' | 'updatedAt'> = {
                id: newId,
                name: newName,
                icon: source.icon,
                description: source.description,
                isSystem: false, // Duplicates are always custom
                active: false, // Start inactive
                version: 1,
                schema: JSON.parse(JSON.stringify(source.schema)), // Deep clone
                createdBy: source.createdBy,
                updatedBy: source.updatedBy
            };

            return await this.createTemplate(duplicate);
        } catch (error) {
            console.error('Error duplicating template:', error);
            throw error;
        }
    }

    /**
     * Check if products are using this template
     */
    private async checkProductsUsingTemplate(templateId: string): Promise<number> {
        try {
            const productsRef = collection(this.firestore, 'products');
            const q = query(
                productsRef,
                where('productType', '==', templateId),
                limit(1)
            );
            const snapshot = await getDocs(q);
            return snapshot.size;
        } catch (error) {
            console.error('Error checking products using template:', error);
            return 0; // Assume none if check fails
        }
    }

    /**
     * Validate template ID format
     */
    private validateTemplateId(id: string): void {
        if (!/^[a-z0-9_-]+$/.test(id)) {
            throw new Error(
                'Template ID must be lowercase alphanumeric with underscores or hyphens only. ' +
                `Invalid ID: '${id}'`
            );
        }

        if (id.length < 2 || id.length > 50) {
            throw new Error('Template ID must be between 2 and 50 characters');
        }
    }

    /**
     * Validate template data
     */
    private validateTemplate(template: Partial<ProductTypeTemplate>): void {
        const errors: string[] = [];

        // Check required fields
        if (!template.name?.en) {
            errors.push('English name is required');
        }
        if (!template.name?.es) {
            errors.push('Spanish name is required');
        }
        if (!template.icon) {
            errors.push('Icon is required');
        }
        if (template.schema) {
            this.validateSchema(template.schema);
        }

        if (errors.length > 0) {
            throw new Error(`Template validation failed:\n${errors.join('\n')}`);
        }
    }

    /**
     * Validate specification schema
     */
    private validateSchema(schema: any[]): void {
        const errors: string[] = [];
        const keys = new Set<string>();

        schema.forEach((field, index) => {
            // Check for duplicate keys
            if (keys.has(field.key)) {
                errors.push(`Duplicate field key '${field.key}' at position ${index + 1}`);
            }
            keys.add(field.key);

            // Check required field properties
            if (!field.key) {
                errors.push(`Field at position ${index + 1} is missing 'key'`);
            }
            if (!field.label?.en || !field.label?.es) {
                errors.push(`Field '${field.key}' is missing label in both languages`);
            }
            if (!field.type) {
                errors.push(`Field '${field.key}' is missing 'type'`);
            }

            // Validate type-specific requirements
            if (field.type === 'select' && (!field.options || field.options.length === 0)) {
                errors.push(`Select field '${field.key}' must have at least one option`);
            }

            if (field.type === 'number') {
                if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
                    errors.push(`Field '${field.key}' has min (${field.min}) greater than max (${field.max})`);
                }
            }
        });

        if (errors.length > 0) {
            throw new Error(`Schema validation failed:\n${errors.join('\n')}`);
        }
    }
}
