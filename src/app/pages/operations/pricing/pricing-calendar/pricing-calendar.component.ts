
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { PricingRule, PricingRuleAction, PricingRuleTargetType } from '../../../../core/models/pricing-rules.model';
import { PricingRulesService } from '../../../../core/services/pricing-rules.service';

@Component({
    selector: 'app-pricing-calendar',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    templateUrl: './pricing-calendar.component.html',
    styles: [`
    .calendar-grid {
      display: grid;
      grid-template-columns: 200px repeat(12, 1fr);
    }
  `]
})
export class PricingCalendarComponent implements OnInit {

    // Dependencies
    private rulesService = inject(PricingRulesService);

    // State
    currentYear = signal(new Date().getFullYear());
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    rules = signal<PricingRule[]>([]);
    isLoading = signal(false);

    // UI State
    isModalOpen = signal(false);
    editingRuleId = signal<string | null>(null); // Track if editing
    newRule: Partial<PricingRule> & { startStr?: string, endStr?: string, recurrence?: boolean } = {
        name: '',
        targetType: 'CATEGORY',
        targetValue: 'Sport',
        action: 'SET_MARGIN',
        value: 20,
        priority: 10,
        active: true,
        recurrence: true
    };

    ngOnInit() {
        this.loadRules();
    }

    async loadRules() {
        this.isLoading.set(true);
        try {
            const allRules = await this.rulesService.getRules();
            this.rules.set(allRules.filter(r => !!r.schedule));
        } catch (e) {
            console.error('Failed to load rules', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    changeYear(delta: number) {
        this.currentYear.update(y => y + delta);
    }

    // Computed visual items for the gantt chart
    timelineItems = computed(() => {
        const year = this.currentYear();

        return this.rules().map(rule => {
            if (!rule.schedule) return null;

            const startDate = rule.schedule.startDate instanceof Date ? rule.schedule.startDate : (rule.schedule.startDate as any).toDate();
            const endDate = rule.schedule.endDate ? (rule.schedule.endDate instanceof Date ? rule.schedule.endDate : (rule.schedule.endDate as any).toDate()) : null;

            // Filter: If rule is not in this year (and not recurring)
            if (rule.schedule.recurrence !== 'ANNUAL') {
                if (startDate.getFullYear() !== year && endDate?.getFullYear() !== year) return null;
            }

            const startMonthIndex = startDate.getMonth(); // 0-11
            const startOffset = (startDate.getDate() / 30);

            let durationMonths = 1;
            if (endDate) {
                durationMonths = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
            }

            // 12 months = 100% width
            const leftPercent = ((startMonthIndex + startOffset) / 12) * 100;
            const widthPercent = (durationMonths / 12) * 100;

            return {
                ...rule,
                style: {
                    left: `${leftPercent}%`,
                    width: `${Math.max(widthPercent, 1)}%`
                },
                color: rule.action === 'SET_MARGIN' ? 'bg-emerald-500' : 'bg-purple-500'
            };
        }).filter(Boolean) as any[];
    });

    // Actions
    openAddModal(existingRule?: PricingRule) {
        if (existingRule) {
            // Edit Mode
            this.editingRuleId.set(existingRule.id!);
            const schedule = existingRule.schedule!;

            const start = schedule.startDate instanceof Date ? schedule.startDate : (schedule.startDate as any).toDate();
            const end = schedule.endDate ? (schedule.endDate instanceof Date ? schedule.endDate : (schedule.endDate as any).toDate()) : null;

            this.newRule = {
                ...existingRule,
                startStr: start.toISOString().split('T')[0],
                endStr: end ? end.toISOString().split('T')[0] : '',
                recurrence: schedule.recurrence === 'ANNUAL'
            };
        } else {
            // Create Mode
            this.editingRuleId.set(null);
            this.newRule = {
                name: 'New Campaign',
                targetType: 'CATEGORY',
                targetValue: 'Sport',
                action: 'SET_MARGIN',
                value: 25,
                priority: 10,
                active: true,
                recurrence: true,
                startStr: new Date().toISOString().split('T')[0],
                endStr: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0]
            };
        }
        this.isModalOpen.set(true);
    }

    closeModal() {
        this.isModalOpen.set(false);
    }

    async saveRule() {
        if (!this.newRule.name || !this.newRule.startStr) return;

        const schedule = {
            startDate: new Date(this.newRule.startStr),
            endDate: this.newRule.endStr ? new Date(this.newRule.endStr) : undefined,
            recurrence: this.newRule.recurrence ? 'ANNUAL' : 'NONE'
        };

        const ruleData: PricingRule = {
            name: this.newRule.name,
            targetType: this.newRule.targetType as PricingRuleTargetType,
            targetValue: this.newRule.targetValue,
            action: this.newRule.action as PricingRuleAction,
            value: this.newRule.value,
            priority: this.newRule.priority || 1,
            active: true,
            schedule: schedule as any
        };

        if (this.editingRuleId()) {
            await this.rulesService.updateRule(this.editingRuleId()!, ruleData);
        } else {
            await this.rulesService.createRule(ruleData);
        }

        this.closeModal();
        this.loadRules();
    }

    async deleteRule(id?: string, event?: Event) {
        if (event) event.stopPropagation(); // Prevent opening edit modal
        if (!id) return;
        if (confirm('Delete this scheduled rule?')) {
            await this.rulesService.deleteRule(id);
            this.loadRules();
        }
    }
}
