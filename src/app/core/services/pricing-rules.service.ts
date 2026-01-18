import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, Timestamp, query, orderBy } from '@angular/fire/firestore';
import { PricingRule } from '../models/pricing-rules.model';
import { PricingTemplate, PricingTemplate as SimplePricingTemplate } from '../models/pricing-template.model';
import { Product } from '../models/product.model';

@Injectable({
    providedIn: 'root'
})
export class PricingRulesService {
    private firestore = inject(Firestore);
    private rulesCollection = collection(this.firestore, 'pricing_rules');

    async getRules(): Promise<PricingRule[]> {
        const q = query(this.rulesCollection, orderBy('priority', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PricingRule));
    }

    async createRule(rule: PricingRule): Promise<string> {
        const docRef = await addDoc(this.rulesCollection, {
            ...rule,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        });
        return docRef.id;
    }

    async updateRule(id: string, rule: Partial<PricingRule>): Promise<void> {
        await updateDoc(doc(this.firestore, 'pricing_rules', id), {
            ...rule,
            updatedAt: Timestamp.now()
        });
    }

    async deleteRule(id: string): Promise<void> {
        await deleteDoc(doc(this.firestore, 'pricing_rules', id));
    }

    /**
     * Find the highest priority rule applicable to this product.
     */
    getApplicableRule(product: Product, rules: PricingRule[]): PricingRule | null {
        // Rules are already sorted by priority desc if fetched via getRules()

        for (const rule of rules) {
            if (!rule.active) continue;

            switch (rule.targetType) {
                case 'GLOBAL':
                    return rule;

                case 'BRAND':
                    if (product.brand && rule.targetValue &&
                        product.brand.toLowerCase() === rule.targetValue.toLowerCase()) {
                        return rule;
                    }
                    break;

                case 'CATEGORY':
                    // Simplistic category matching (exact string match for now)
                    if (product.categoryId && rule.targetValue &&
                        product.categoryId === rule.targetValue) {
                        return rule;
                    }
                    break;
            }
        }

        return null;
    }

    // --- TEMPLATE LOGIC ---
    private templatesCollection = collection(this.firestore, 'pricing_templates');

    async getTemplates(): Promise<PricingTemplate[]> {
        const q = query(this.templatesCollection, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PricingTemplate));
    }

    async createTemplate(template: SimplePricingTemplate): Promise<string> {
        const docRef = await addDoc(this.templatesCollection, {
            ...template,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        });
        return docRef.id;
    }

    async updateTemplate(id: string, template: Partial<PricingTemplate>): Promise<void> {
        await updateDoc(doc(this.firestore, 'pricing_templates', id), {
            ...template,
            updatedAt: Timestamp.now()
        });
    }

    async deleteTemplate(id: string): Promise<void> {
        await deleteDoc(doc(this.firestore, 'pricing_templates', id));
    }
}
