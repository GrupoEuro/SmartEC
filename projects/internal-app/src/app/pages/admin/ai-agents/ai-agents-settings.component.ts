import { Component, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AiAgentService } from '../../../core/services/ai-agent.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ToastService } from '../../../core/services/toast.service';
import {
    BusinessHoursConfig, DayOfWeek, DaySchedule,
    DEFAULT_BUSINESS_HOURS, DEFAULT_DEPARTMENTS
} from '../../../core/models/ai-agent.model';

export interface DepartmentConfig {
    id:          string;
    name:        string;
    description: string;
    email:       string;
    order:       number;
}

export interface GeminiConfig {
    defaultModel:       string;
    defaultTemperature: number;
    defaultMaxTokens:   number;
    monthlyTokenBudget: number;
}

export interface NotificationConfig {
    handoffEmailEnabled:    boolean;
    handoffEmailRecipients: string;
    inboxSoundEnabled:      boolean;
    handoffBannerEnabled:   boolean;
}

const TIMEZONES = [
    { value: 'America/Mexico_City',  label: 'Ciudad de México (CST/CDT)' },
    { value: 'America/Monterrey',    label: 'Monterrey (CST/CDT)' },
    { value: 'America/Tijuana',      label: 'Tijuana (PST/PDT)' },
    { value: 'America/Cancun',       label: 'Cancún (EST)' },
    { value: 'America/Chicago',      label: 'Chicago (CST/CDT)' },
    { value: 'America/New_York',     label: 'Nueva York (EST/EDT)' },
    { value: 'America/Los_Angeles',  label: 'Los Ángeles (PST/PDT)' },
    { value: 'UTC',                  label: 'UTC' },
];

const DAYS: DayOfWeek[] = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_LABELS: Record<DayOfWeek, string> = {
    monday:'Lunes', tuesday:'Martes', wednesday:'Miércoles',
    thursday:'Jueves', friday:'Viernes', saturday:'Sábado', sunday:'Domingo'
};

@Component({
    selector: 'app-ai-agents-settings',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule, AppIconComponent],
    templateUrl: './ai-agents-settings.component.html',
    styleUrls: ['./ai-agents-settings.component.css'],
})
export class AiAgentsSettingsComponent implements OnInit, OnDestroy {
    private svc   = inject(AiAgentService);
    private toast = inject(ToastService);

    activeTab = signal<'hours' | 'departments' | 'gemini' | 'notifications'>('hours');
    saving    = signal(false);
    loading   = signal(true);

    readonly TIMEZONES  = TIMEZONES;
    readonly DAYS       = DAYS;
    readonly DAY_LABELS = DAY_LABELS;

    // ── Business Hours ────────────────────────────────────────────────────────
    businessHours: BusinessHoursConfig = structuredClone(DEFAULT_BUSINESS_HOURS);
    isOpenNow = signal(false);
    currentTimeStr = signal('');

    // ── Departments ───────────────────────────────────────────────────────────
    departments = signal<DepartmentConfig[]>([]);
    newDept: Partial<DepartmentConfig> = { name: '', description: '', email: '' };
    deptSaving = signal(false);

    // ── Gemini ────────────────────────────────────────────────────────────────
    geminiConfig: GeminiConfig = {
        defaultModel:       'gemini-1.5-pro',
        defaultTemperature: 0.7,
        defaultMaxTokens:   512,
        monthlyTokenBudget: 1_000_000,
    };
    tokenUsageMonth = signal(0);

    // ── Notifications ─────────────────────────────────────────────────────────
    notifConfig: NotificationConfig = {
        handoffEmailEnabled:    false,
        handoffEmailRecipients: '',
        inboxSoundEnabled:      true,
        handoffBannerEnabled:   true,
    };

    private sub?: Subscription;
    private clockInterval?: ReturnType<typeof setInterval>;

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    ngOnInit() {
        this.loadAll();
        this.startClock();
    }

    ngOnDestroy() {
        this.sub?.unsubscribe();
        clearInterval(this.clockInterval);
    }

    private async loadAll() {
        this.loading.set(true);
        try {
            // Business hours
            const bh = await this.svc.getBusinessHours();
            this.businessHours = bh;
            this.updateOpenNow();

            // Departments
            await this.loadDepartments();

            // Gemini + Notifications from Firestore
            await this.loadGeminiConfig();
            await this.loadNotifConfig();
        } finally {
            this.loading.set(false);
        }
    }

    private async loadDepartments() {
        const existing = await this.getDeptFromFirestore();
        this.departments.set(existing);
    }

    private async getDeptFromFirestore(): Promise<DepartmentConfig[]> {
        const snap = await this.svc.getDepartmentsConfig();
        if (snap?.departments?.length) return snap.departments;
        return DEFAULT_DEPARTMENTS.map((name, i) => ({
            id:          name.toLowerCase().replace(/\s+/g, '_'),
            name, description: '', email: '', order: i
        }));
    }

    private async loadGeminiConfig() {
        try {
            const cfg = await this.svc.getGeminiConfig();
            if (cfg) this.geminiConfig = cfg;
            const stats = await this.svc.getOverallStats();
            this.tokenUsageMonth.set(stats.handledMonth); // approx proxy
        } catch { /* defaults */ }
    }

    private async loadNotifConfig() {
        try {
            const cfg = await this.svc.getNotifConfig();
            if (cfg) this.notifConfig = cfg;
        } catch { /* defaults */ }
    }

    // ── Clock ─────────────────────────────────────────────────────────────────
    private startClock() {
        this.updateOpenNow();
        this.clockInterval = setInterval(() => this.updateOpenNow(), 30_000);
    }

    updateOpenNow() {
        this.isOpenNow.set(this.svc.isWithinBusinessHours(this.businessHours));
        const tz = this.businessHours.timezone || 'America/Mexico_City';
        this.currentTimeStr.set(
            new Intl.DateTimeFormat('es-MX', {
                timeZone: tz, weekday:'long', hour:'2-digit', minute:'2-digit'
            }).format(new Date())
        );
    }

    // ── Business Hours helpers ────────────────────────────────────────────────
    getDay(day: DayOfWeek): DaySchedule {
        return this.businessHours.schedule[day] ?? { enabled: true, openTime:'09:00', closeTime:'18:00' };
    }

    applyPreset(preset: 'standard' | 'retail' | 'extendido' | '24x7') {
        const s = this.businessHours.schedule;
        const weekdays: DayOfWeek[] = ['monday','tuesday','wednesday','thursday','friday'];
        if (preset === 'standard') {
            weekdays.forEach(d => { s[d] = { enabled:true, openTime:'09:00', closeTime:'18:00' }; });
            s.saturday = { enabled:true,  openTime:'09:00', closeTime:'14:00' };
            s.sunday   = { enabled:false, openTime:'09:00', closeTime:'14:00' };
        } else if (preset === 'retail') {
            weekdays.forEach(d => { s[d] = { enabled:true, openTime:'10:00', closeTime:'20:00' }; });
            s.saturday = { enabled:true, openTime:'10:00', closeTime:'20:00' };
            s.sunday   = { enabled:true, openTime:'11:00', closeTime:'18:00' };
        } else if (preset === 'extendido') {
            DAYS.forEach(d => { s[d] = { enabled:true, openTime:'08:00', closeTime:'21:00' }; });
        } else if (preset === '24x7') {
            DAYS.forEach(d => { s[d] = { enabled:true, openTime:'00:00', closeTime:'23:59' }; });
        }
        this.businessHours = { ...this.businessHours, schedule: { ...s } };
        this.updateOpenNow();
        this.toast.info('Horario aplicado — guarda para confirmar los cambios.');
    }

    copyMondayToWeekdays() {
        const mon = this.businessHours.schedule.monday;
        (['tuesday','wednesday','thursday','friday'] as DayOfWeek[]).forEach(d => {
            this.businessHours.schedule[d] = { ...mon };
        });
        this.businessHours = { ...this.businessHours };
        this.toast.info('Lunes copiado a días hábiles.');
    }

    async saveBusinessHours() {
        this.saving.set(true);
        try {
            await this.svc.saveBusinessHours(this.businessHours);
            this.updateOpenNow();
            this.toast.success('Horario guardado ✓ — los agentes usarán este horario en tiempo real.');
        } catch (e: any) {
            this.toast.error('Error al guardar: ' + (e?.message ?? ''));
        } finally { this.saving.set(false); }
    }

    // ── Departments ───────────────────────────────────────────────────────────
    async addDept() {
        if (!this.newDept.name?.trim()) return;
        this.deptSaving.set(true);
        try {
            const dept: DepartmentConfig = {
                id:          Date.now().toString(),
                name:        this.newDept.name.trim(),
                description: this.newDept.description?.trim() ?? '',
                email:       this.newDept.email?.trim() ?? '',
                order:       this.departments().length,
            };
            const updated = [...this.departments(), dept];
            await this.svc.saveDepartmentsConfig({ departments: updated });
            this.departments.set(updated);
            this.newDept = { name:'', description:'', email:'' };
            this.toast.success('Departamento agregado');
        } finally { this.deptSaving.set(false); }
    }

    async removeDept(id: string) {
        const updated = this.departments().filter(d => d.id !== id);
        await this.svc.saveDepartmentsConfig({ departments: updated });
        this.departments.set(updated);
        this.toast.success('Departamento eliminado');
    }

    async saveDepts() {
        this.saving.set(true);
        try {
            await this.svc.saveDepartmentsConfig({ departments: this.departments() });
            this.toast.success('Departamentos guardados ✓');
        } finally { this.saving.set(false); }
    }

    // ── Gemini ────────────────────────────────────────────────────────────────
    async saveGemini() {
        this.saving.set(true);
        try {
            await this.svc.saveGeminiConfig(this.geminiConfig);
            this.toast.success('Configuración de Gemini guardada ✓');
        } finally { this.saving.set(false); }
    }

    get tokenBudgetPct(): number {
        return Math.min(100, Math.round((this.tokenUsageMonth() / this.geminiConfig.monthlyTokenBudget) * 100));
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    async saveNotif() {
        this.saving.set(true);
        try {
            await this.svc.saveNotifConfig(this.notifConfig);
            this.toast.success('Notificaciones guardadas ✓');
        } finally { this.saving.set(false); }
    }

    formatTime(time: string): string {
        if (!time) return '';
        const [h, m] = time.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const dh   = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${dh}:${String(m).padStart(2,'0')} ${ampm}`;
    }

    /** Parses comma-formatted string from the text input into the raw number model */
    setTokenBudget(value: string) {
        const num = parseInt(value.replace(/,/g, ''), 10);
        if (!isNaN(num) && num > 0) this.geminiConfig.monthlyTokenBudget = num;
    }
}
