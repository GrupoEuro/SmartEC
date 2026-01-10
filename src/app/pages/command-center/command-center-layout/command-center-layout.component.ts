import { Component, inject, AfterViewInit, signal, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { AlertTriggerService } from '../../../core/services/alert-trigger.service';
import { CommandCenterHeaderComponent } from '../header/command-center-header.component';
import { ApprovalWorkflowService } from '../../../core/services/approval-workflow.service';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-command-center-layout',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        TranslateModule,
        AppIconComponent,
        CommandCenterHeaderComponent
    ],
    template: `
        <div class="command-center-layout">
            <!-- Sidebar -->
            <aside class="sidebar">
                <div class="sidebar-header">
                    <div class="logo">
                        <span class="logo-icon">
                            <app-icon name="command-center" [size]="28"></app-icon>
                        </span>
                        <h2>{{ 'COMMAND_CENTER.TITLE' | translate }}</h2>
                    </div>
                </div>

                <nav class="sidebar-nav">
                    <!-- Section 1: Command (Pulse) -->
                    <a routerLink="/command-center/dashboard" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                           <app-icon name="dashboard" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.DASHBOARD' | translate }}</span>
                    </a>

                    <a routerLink="/command-center/approvals" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                            <app-icon name="check-circle" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.APPROVALS.TITLE' | translate }}</span>
                        <span class="notification-badge" *ngIf="pendingApprovalsCount() > 0">
                            {{ pendingApprovalsCount() }}
                        </span>
                    </a>
                    
                    <div class="nav-separator"></div>
                    
                    <!-- Section 2: Strategy (Boardroom) -->
                    <div class="nav-section-label">STRATEGY</div>
                    <a routerLink="/command-center/financials" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                            <app-icon name="chart-pie" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.FINANCIALS.TITLE' | translate }}</span>
                    </a>
                    <a routerLink="/command-center/income-statement" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                            <app-icon name="document" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.INCOME_STATEMENT.TITLE' | translate }}</span>
                    </a>
                    <a routerLink="/command-center/inventory-analytics" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                            <app-icon name="box" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.INVENTORY_ANALYTICS.TITLE' | translate }}</span>
                    </a>
                    
                    <div class="nav-separator"></div>
                    
                    <!-- Section 3: Growth (Market) -->
                    <div class="nav-section-label">GROWTH</div>
                    <a routerLink="/command-center/sales-analytics" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                            <app-icon name="chart-bar" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.SALES_ANALYTICS.TITLE' | translate }}</span>
                    </a>
                    <a routerLink="/command-center/customer-insights" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                            <app-icon name="users" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.CUSTOMER_INSIGHTS.TITLE' | translate }}</span>
                    </a>
                    
                    <div class="nav-separator"></div>

                    <!-- Section 4: Operations (Engine Room) -->
                    <div class="nav-section-label">OPERATIONS</div>
                    <a routerLink="/command-center/operational-metrics" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                            <app-icon name="activity" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.OPERATIONAL_METRICS.TITLE' | translate }}</span>
                    </a>
                    <a routerLink="/command-center/expenses" routerLinkActive="active" class="nav-item">
                        <span class="nav-icon">
                            <app-icon name="wallet" [size]="20"></app-icon>
                        </span>
                        <span class="nav-label">{{ 'COMMAND_CENTER.EXPENSES.TITLE' | translate }}</span>
                    </a>
                </nav>

                <div class="sidebar-footer">
                    <a routerLink="/" class="back-link">
                        <span class="nav-icon">
                            <app-icon name="arrow-left" [size]="18"></app-icon>
                        </span>
                        <span>{{ 'ADMIN.GO_HOME' | translate }}</span>
                    </a>
                </div>
            </aside>

            <!-- Main Content -->
            <main class="main-content">
                <!-- New Header Component -->
                <app-command-center-header></app-command-center-header>

                <!-- Content Area -->
                <div class="content-wrapper">
                    <router-outlet></router-outlet>
                </div>
            </main>
        </div>
    `,
    styles: [`
        .command-center-layout {
            display: flex;
            min-height: 100vh;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }

        .sidebar {
            width: 280px;
            background: rgba(15, 23, 42, 0.95);
            border-right: 1px solid rgba(148, 163, 184, 0.1);
            display: flex;
            flex-direction: column;
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            position: fixed;
            height: 100vh;
            z-index: 50;
        }

        .sidebar-header {
            /* Adjusted to match Header Height of 88px */
            /* 1.875rem (30px) * 2 + 28px icon = 88px */
            padding: 1.875rem 1.5rem; 
            border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .logo-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fbbf24;
            filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.3));
        }

        .logo h2 {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 700;
            background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .sidebar-nav {
            flex: 1;
            padding: 1.5rem 1rem;
            overflow-y: auto;
        }

        .nav-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.875rem 1rem;
            margin-bottom: 0.25rem;
            border-radius: 0.5rem;
            color: #94a3b8;
            text-decoration: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            font-weight: 500;
            position: relative;
        }

        .nav-item:hover {
            background: rgba(255, 255, 255, 0.03);
            color: #e2e8f0;
        }

        .nav-item.active {
            background: linear-gradient(90deg, rgba(251, 191, 36, 0.15) 0%, rgba(251, 191, 36, 0.05) 100%);
            color: #fbbf24;
            border-left: 3px solid #fbbf24;
        }

        .nav-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.8;
        }

        .nav-item.active .nav-icon {
            opacity: 1;
        }

        .nav-section-label {
            padding: 1.5rem 1rem 0.75rem 1rem;
            font-size: 0.7rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #475569;
        }

        .nav-separator {
            height: 1px;
            background: linear-gradient(90deg, transparent 0%, rgba(148, 163, 184, 0.1) 50%, transparent 100%);
            margin: 0.5rem 0;
        }

        .sidebar-footer {
            padding: 1.5rem;
            border-top: 1px solid rgba(148, 163, 184, 0.1);
        }

        .back-link {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.75rem 1rem;
            border-radius: 0.5rem;
            color: #94a3b8;
            text-decoration: none;
            transition: all 0.2s;
            font-size: 0.875rem;
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid rgba(148, 163, 184, 0.1);
        }

        .back-link:hover {
            background: rgba(148, 163, 184, 0.1);
            color: #e2e8f0;
            border-color: rgba(148, 163, 184, 0.2);
        }

        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin-left: 280px;
        }

        /* Content Wrapper */
        .content-wrapper {
            flex: 1;
            overflow-y: auto;
            scroll-behavior: smooth;
        }
        
        .notification-badge {
            background: #ef4444;
            color: white;
            font-size: 0.7rem;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 12px;
            margin-left: auto;
            min-width: 18px;
            text-align: center;
            box-shadow: 0 0 10px rgba(239, 68, 68, 0.4);
        }

        @media (max-width: 1024px) {
             .sidebar {
                width: 70px;
            }
            .sidebar-header h2, .nav-label, .nav-section-label, .sidebar-footer span:last-child  {
                display: none;
            }
            .main-content {
                margin-left: 70px;
            }
            .notification-badge {
                position: absolute;
                top: 8px;
                right: 8px;
            }
        }

        @media (max-width: 768px) {
            .sidebar {
                display: none; 
            }
            .main-content {
                margin-left: 0;
            }
        }
    `]
})
export class CommandCenterLayoutComponent implements AfterViewInit, OnDestroy {
    alertTriggerService = inject(AlertTriggerService);
    approvalService = inject(ApprovalWorkflowService);

    pendingApprovalsCount = signal(0);
    private sub!: Subscription;

    constructor() {
        // Subscribe to pending approvals for the badge
        this.sub = this.approvalService.getPendingRequests().subscribe(requests => {
            this.pendingApprovalsCount.set(requests.length);
        });
    }

    ngAfterViewInit() {
        // Run intelligent checks after the view has initialized
        setTimeout(() => {
            this.alertTriggerService.runChecks();
        }, 0);
    }

    ngOnDestroy() {
        if (this.sub) {
            this.sub.unsubscribe();
        }
    }
}

