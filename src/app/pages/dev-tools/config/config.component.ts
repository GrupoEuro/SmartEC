import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DevConfigService } from '../../../core/services/dev-config.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-dev-config',
  standalone: true,
  imports: [CommonModule, AppIconComponent, FormsModule],
  styleUrls: ['./config.component.css'],
  template: `
    <div class="config-container">
      <div class="config-header">
        <h1 class="page-title">Configuration Manager</h1>
        <p class="page-subtitle">Control runtime behavior, feature flags, and system state.</p>
      </div>

      <div class="control-panel-grid">
        
        <!-- Column 1: Environment & System -->
        <div class="panel-column">
            <!-- Environment -->
            <div class="glass-panel">
                <div class="panel-header">
                    <app-icon name="server" [size]="20" class="text-blue-400"></app-icon>
                    <h2>Environment</h2>
                </div>
                <div class="env-badges">
                    <div class="badge" [class.badge-prod]="environment.production" [class.badge-dev]="!environment.production">
                        {{ environment.production ? 'PROD' : 'DEV' }}
                    </div>
                    <div class="badge badge-neutral">v1.2.0</div>
                </div>
                <div class="code-preview">
                    <pre>{{ environment | json }}</pre>
                </div>
            </div>

            <!-- Storage -->
            <div class="glass-panel">
                <div class="panel-header">
                    <app-icon name="database" [size]="20" class="text-orange-400"></app-icon>
                    <h2>System Storage</h2>
                </div>
                <div class="stat-row">
                    <div class="stat-item">
                        <span class="label">Local</span>
                        <span class="value">{{ storageInfo().localStorageCount }} <span class="unit">keys</span></span>
                    </div>
                    <div class="stat-item">
                        <span class="label">Session</span>
                        <span class="value">{{ storageInfo().sessionStorageCount }} <span class="unit">keys</span></span>
                    </div>
                </div>
                <div class="actions-group">
                    <button (click)="clearLocalStorage()" class="btn-action danger">
                        <app-icon name="trash" [size]="14"></app-icon> Wipe Local
                    </button>
                    <button (click)="reloadApp()" class="btn-action neutral">
                        <app-icon name="refresh" [size]="14"></app-icon> Reload
                    </button>
                </div>
            </div>
        </div>

        <!-- Column 2: Access Control (God Mode) -->
        <div class="panel-column">
            <div class="glass-panel god-mode">
                <div class="panel-header">
                    <app-icon name="zap" [size]="20" class="text-yellow-400"></app-icon>
                    <h2>God Mode</h2>
                    <span class="live-indicator" *ngIf="guardsBypassed() || currentRole()">ACTIVE</span>
                </div>
                
                <div class="control-section">
                    <label>Security Guards</label>
                    <div class="toggle-wrapper" (click)="toggleGuards()" [class.active]="guardsBypassed()">
                        <div class="toggle-track"></div>
                        <div class="toggle-thumb"></div>
                        <span class="toggle-label">{{ guardsBypassed() ? 'Bypassed' : 'Enforced' }}</span>
                    </div>
                    <p class="help-text">Disable all route guards and permission checks.</p>
                </div>

                <div class="control-section">
                    <label>Impersonate Role</label>
                    <div class="role-grid">
                        <button *ngFor="let role of roles" 
                                (click)="setRole(role.value)"
                                [class.active]="currentRole() === role.value"
                                class="role-chip">
                            {{ role.label }}
                        </button>
                    </div>
                    <button *ngIf="currentRole()" (click)="setRole(null)" class="btn-reset">
                        Reset to Real User
                    </button>
                </div>
            </div>
            
            <!-- Log Level -->
             <div class="glass-panel">
                <div class="panel-header">
                    <app-icon name="list" [size]="20" class="text-slate-400"></app-icon>
                    <h2>Log Level</h2>
                </div>
                <div class="tabs">
                    <button *ngFor="let level of ['DEBUG', 'INFO', 'WARN', 'ERROR']"
                            (click)="setLogLevel(level)"
                            [class.active]="logLevel() === level"
                            class="tab-btn">
                        {{ level }}
                    </button>
                </div>
            </div>
        </div>

        <!-- Column 3: Feature Flags -->
        <div class="panel-column">
            <div class="glass-panel">
                <div class="panel-header">
                    <app-icon name="flag" [size]="20" class="text-purple-400"></app-icon>
                    <h2>Feature Flags</h2>
                </div>
                
                <div class="flag-list">
                    <div class="flag-item" *ngFor="let item of featureFlags | keyvalue">
                        <div class="flag-info">
                            <span class="flag-name">{{ formatFlagName($any(item.key)) }}</span>
                            <span class="flag-key">{{ item.key }}</span>
                        </div>
                        <div class="toggle-switch" 
                             [class.checked]="item.value"
                             (click)="toggleFlag($any(item.key), item.value)">
                            <div class="switch-handle"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

      </div>
    </div>
  `
})
export class ConfigComponent {
  private configService = inject(DevConfigService);

  // Core Data
  environment = this.configService.getEnvironment();
  storageInfo = signal(this.configService.getStorageSummary());

  // State Signals
  guardsBypassed = signal(this.configService.shouldBypassGuards());
  currentRole = signal<string | null>(this.configService.getImpersonatedRole());
  featureFlags: any = this.configService.getFeatureFlags();
  logLevel = signal(this.configService.getLogLevel());

  roles = [
    { label: 'Admin', value: 'ADMIN' },
    { label: 'Manager', value: 'MANAGER' },
    { label: 'Staff', value: 'STAFF' },
    { label: 'Customer', value: 'CUSTOMER' }
  ];

  // Actions
  toggleGuards() {
    const newState = !this.guardsBypassed();
    this.configService.setBypassGuards(newState);
    this.guardsBypassed.set(newState);
  }

  setRole(role: string | null) {
    if (role === this.currentRole()) return;
    this.configService.setImpersonatedRole(role);
  }

  toggleFlag(key: string, currentValue: unknown) {
    if (typeof currentValue !== 'boolean') return;
    this.featureFlags[key] = !currentValue; // Update local state immediately for UI
    this.configService.setFeatureFlag(key, !currentValue);
  }

  setLogLevel(level: string) {
    this.configService.setLogLevel(level);
    this.logLevel.set(level as any);
  }

  clearLocalStorage() {
    if (confirm('Clear local storage? You will be logged out.')) {
      this.configService.clearLocalStorage();
      window.location.reload();
    }
  }

  reloadApp() {
    window.location.reload();
  }

  // Helpers
  formatFlagName(key: string): string {
    // enableHighFrequencyUpdates -> Enable High Frequency Updates
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase());
  }
}
