import { Component, inject, signal, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PricingRulesService } from '../../../../core/services/pricing-rules.service';
import { PricingRule, PricingRuleTargetType, PricingRuleAction } from '../../../../core/models/pricing-rules.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-pricing-rules-manager',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    templateUrl: './pricing-rules-manager.component.html',
    styleUrls: ['./pricing-rules-manager.component.css']
})
export class PricingRulesManagerComponent {
    @Output() close = new EventEmitter<void>();
    private rulesService = inject(PricingRulesService);

    rules = signal<PricingRule[]>([]);
    loading = signal(false);

    // Form State
    showForm = signal(false);
    editingId = signal<string | null>(null);

    // New Rule Model
    currentRule: Partial<PricingRule> = {
        name: '',
        targetType: 'CATEGORY',
        targetValue: '',
        action: 'SET_MARGIN',
        value: 20,
        priority: 10,
        active: true
    };

    async ngOnInit() {
        await this.loadRules();
    }

    async loadRules() {
        this.loading.set(true);
        try {
            const data = await this.rulesService.getRules();
            this.rules.set(data);
        } catch (e) {
            console.error('Error loading rules', e);
        } finally {
            this.loading.set(false);
        }
    }

    openNew() {
        this.editingId.set(null);
        this.currentRule = {
            name: '',
            targetType: 'CATEGORY',
            targetValue: '',
            action: 'SET_MARGIN',
            value: 20,
            priority: 10,
            active: true
        };
        this.showForm.set(true);
    }

    editRule(rule: PricingRule) {
        this.editingId.set(rule.id!);
        this.currentRule = { ...rule };
        this.showForm.set(true);
    }

    cancelEdit() {
        this.showForm.set(false);
        this.editingId.set(null);
    }

    async saveRule() {
        if (!this.currentRule.name) return; // Simple validation

        this.loading.set(true);
        try {
            if (this.editingId()) {
                await this.rulesService.updateRule(this.editingId()!, this.currentRule);
            } else {
                await this.rulesService.createRule(this.currentRule as PricingRule);
            }
            await this.loadRules();
            this.showForm.set(false);
        } catch (e) {
            console.error('Error saving rule', e);
        } finally {
            this.loading.set(false);
        }
    }

    async deleteRule(id: string) {
        if (!confirm('Are you sure you want to delete this rule?')) return;

        this.loading.set(true);
        try {
            await this.rulesService.deleteRule(id);
            await this.loadRules();
        } catch (e) {
            console.error('Error deleting rule', e);
        } finally {
            this.loading.set(false);
        }
    }
}
