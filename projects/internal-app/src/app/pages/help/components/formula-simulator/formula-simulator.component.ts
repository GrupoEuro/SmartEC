import { Component, Input, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface SimulationVariable {
  key: string;
  label: string;
  value: number;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
}

export interface SimulationConfig {
  variables: SimulationVariable[];
  calculate: (values: Record<string, number>) => number;
  resultLabel: string;
  resultSuffix?: string;
  resultFormat?: 'number' | 'currency' | 'percent';
  interpretation?: (value: number) => { text: string, status: 'good' | 'warning' | 'bad' | 'neutral' };
}

@Component({
  selector: 'app-formula-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="simulator-container">
      <div class="header">
        <h3>⚡ Interactive Simulator</h3>
        <p>Adjust the values to see how they impact the result.</p>
      </div>

      <div class="simulator-body">
        <!-- Inputs Column -->
        <div class="inputs-section">
          <div *ngFor="let v of variables()" class="input-group">
            <label>{{ v.label }} <span class="var-key">({{ v.key }})</span></label>
            <div class="input-wrapper">
              <input 
                type="number" 
                [ngModel]="v.value" 
                (ngModelChange)="updateValue(v.key, $event)"
                [step]="v.step || 1"
                [min]="v.min || 0"
                [max]="v.max || null"
                class="sim-input"
              >
              <span *ngIf="v.suffix" class="suffix">{{ v.suffix }}</span>
            </div>
            <input 
              type="range" 
              [ngModel]="v.value" 
              (ngModelChange)="updateValue(v.key, $event)"
              [step]="v.step || 1" 
              [min]="v.min || 0" 
              [max]="v.max || (v.value * 2) || 100"
              class="range-slider"
            >
          </div>
        </div>

        <!-- Result Column -->
        <div class="result-section">
          <div class="result-card">
            <span class="result-label">{{ config()?.resultLabel }}</span>
            <div class="result-value" [ngSwitch]="config()?.resultFormat">
              <span *ngSwitchCase="'currency'">{{ result() | currency:'USD':'symbol':'1.0-2' }}</span>
              <span *ngSwitchCase="'percent'">{{ result() | number:'1.1-2' }}<span class="result-suffix">%</span></span>
              <span *ngSwitchDefault>{{ result() | number:'1.1-2' }}<span class="result-suffix">{{ config()?.resultSuffix }}</span></span>
            </div>
            
            <!-- Interpretation / Feedback -->
            <div *ngIf="interpretation() as interp" class="interpretation-badge" [ngClass]="interp.status">
                <span class="interp-icon" [ngSwitch]="interp.status">
                    <span *ngSwitchCase="'good'">✅</span>
                    <span *ngSwitchCase="'warning'">⚠️</span>
                    <span *ngSwitchCase="'bad'">🛑</span>
                    <span *ngSwitchDefault>ℹ️</span>
                </span>
                {{ interp.text }}
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .simulator-container {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.5rem;
      margin-top: 1.5rem;
      backdrop-filter: blur(8px);
    }

    .header h3 {
      font-size: 1.1rem;
      font-weight: 700;
      color: #fbbf24; /* Amber 400 */
      margin: 0 0 0.25rem 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .header p {
      color: #94a3b8;
      font-size: 0.875rem;
      margin: 0 0 1.5rem 0;
    }

    .simulator-body {
      display: grid;
      grid-template-columns: 1fr;
      gap: 2rem;
    }

    @media (min-width: 640px) {
      .simulator-body {
        grid-template-columns: 3fr 2fr;
      }
    }

    .input-group {
      margin-bottom: 1.25rem;
    }

    .input-group:last-child {
      margin-bottom: 0;
    }

    .input-group label {
      display: block;
      color: #cbd5e1;
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
    }

    .var-key {
      color: #64748b;
      font-family: monospace;
      font-size: 0.8em;
    }

    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      margin-bottom: 0.5rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0 0.75rem;
      transition: border-color 0.2s;
    }

    .input-wrapper:focus-within {
      border-color: #fbbf24;
    }

    .sim-input {
      flex: 1;
      background: transparent;
      border: none;
      color: #f8fafc;
      padding: 0.5rem 0;
      font-family: 'Courier New', monospace;
      font-weight: 600;
      font-size: 1rem;
      outline: none;
    }

    .suffix {
      color: #64748b;
      font-size: 0.875rem;
      margin-left: 0.5rem;
    }

    .range-slider {
      width: 100%;
      height: 4px;
      background: #334155;
      border-radius: 2px;
      appearance: none;
      outline: none;
    }

    .range-slider::-webkit-slider-thumb {
      appearance: none;
      width: 16px;
      height: 16px;
      background: #fbbf24;
      border-radius: 50%;
      cursor: pointer;
      transition: transform 0.1s;
    }

    .range-slider::-webkit-slider-thumb:hover {
      transform: scale(1.2);
    }

    .result-section {
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.5);
      border-radius: 12px;
      padding: 1.5rem;
    }

    .result-card {
      text-align: center;
      width: 100%;
    }

    .result-label {
      display: block;
      color: #94a3b8;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .result-value {
      font-size: 2.5rem;
      font-weight: 800;
      color: #fbbf24;
      line-height: 1;
      text-shadow: 0 0 20px rgba(251, 191, 36, 0.2);
      margin-bottom: 1rem;
    }

    .result-suffix {
      font-size: 1rem;
      color: #94a3b8;
      margin-left: 0.25rem;
      font-weight: 600;
    }

    .interpretation-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 999px;
        font-size: 0.85rem;
        font-weight: 600;
        border: 1px solid transparent;
        margin-top: 0.5rem;
    }

    .interpretation-badge.good {
        background: rgba(34, 197, 94, 0.1);
        color: #4ade80;
        border-color: rgba(34, 197, 94, 0.3);
    }

    .interpretation-badge.warning {
        background: rgba(234, 179, 8, 0.1);
        color: #facc15;
        border-color: rgba(234, 179, 8, 0.3);
    }

    .interpretation-badge.bad {
        background: rgba(239, 68, 68, 0.1);
        color: #f87171;
        border-color: rgba(239, 68, 68, 0.3);
    }
  `]
})
export class FormulaSimulatorComponent {
  // Input received from parent
  config = signal<SimulationConfig | undefined>(undefined);

  @Input('config') set _config(val: SimulationConfig | undefined) {
    this.config.set(val);
    if (val) {
      // Initialize internal variables state
      this.variables.set([...val.variables]);
    }
  }

  // Internal state of variables
  variables = signal<SimulationVariable[]>([]);

  // Computed result
  result = computed(() => {
    const cfg = this.config();
    if (!cfg) return 0;

    // Create map of current values
    const valueMap: Record<string, number> = {};
    this.variables().forEach(v => valueMap[v.key] = v.value);

    return cfg.calculate(valueMap);
  });

  // Interpretation
  interpretation = computed(() => {
    const cfg = this.config();
    const val = this.result();
    if (cfg && cfg.interpretation) {
      return cfg.interpretation(val);
    }
    return null;
  });

  updateValue(key: string, newValue: number) {
    this.variables.update(vars =>
      vars.map(v => v.key === key ? { ...v, value: Number(newValue) } : v)
    );
  }
}
