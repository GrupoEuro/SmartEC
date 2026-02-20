import { Component, inject, OnInit, OnDestroy, AfterViewInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { OrderService } from '../../../core/services/order.service';
import { Order, OrderStatus } from '../../../core/models/order.model';
import { OrderPriorityService } from '../../../core/services/order-priority.service';
import { OrderAssignmentService } from '../../../core/services/order-assignment.service';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { ToastService } from '../../../core/services/toast.service';

// Register Chart.js components
Chart.register(...registerables);

interface DashboardStats {
    totalOrders: number;
    pendingOrders: number;
    processingOrders: number;
    shippedToday: number;
}

interface SLAStats {
    total: number;
    onTime: number;
    overdue: number;
    approaching: number;
    complianceRate: number;
}

interface PriorityStats {
    standard: number;
    express: number;
    rush: number;
}

interface StaffWorkload {
    staffName: string;
    assignedOrders: number;
    inProgress: number;
    completed: number;
}

import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-operations-dashboard',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AdminPageHeaderComponent, AppIconComponent],
    templateUrl: './operations-dashboard.component.html',
    styleUrls: ['./operations-dashboard.component.css']
})
export class OperationsDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
    private orderService = inject(OrderService);
    private priorityService = inject(OrderPriorityService);
    private assignmentService = inject(OrderAssignmentService);
    private toast = inject(ToastService);

    stats = signal<DashboardStats>({
        totalOrders: 0,
        pendingOrders: 0,
        processingOrders: 0,
        shippedToday: 0
    });

    slaStats = signal<SLAStats>({
        total: 0,
        onTime: 0,
        overdue: 0,
        approaching: 0,
        complianceRate: 100
    });

    priorityStats = signal<PriorityStats>({
        standard: 0,
        express: 0,
        rush: 0
    });

    staffWorkload = signal<StaffWorkload[]>([]);
    overdueOrders = signal<Order[]>([]);
    recentOrders = signal<Order[]>([]);
    isLoading = signal(true);

    // Chart instances
    private slaChart?: Chart;
    private priorityChart?: Chart;
    private trendChart?: Chart;

    ngOnInit() {
        this.loadDashboardData();
        this.loadSLAStats();
        this.loadPriorityStats();
        this.loadStaffWorkload();
        this.loadOverdueOrders();
    }

    ngAfterViewInit() {
        // Create charts after view is initialized
        setTimeout(() => {
            this.createSLAChart();
            this.createPriorityChart();
            this.createTrendChart();
        }, 500);
    }

    ngOnDestroy() {
        // Cleanup charts
        this.slaChart?.destroy();
        this.priorityChart?.destroy();
        this.trendChart?.destroy();
    }

    private getJsDate(timestamp: any): Date {
        if (!timestamp) return new Date();
        return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    }

    private getTimestampMillis(timestamp: any): number {
        if (!timestamp) return Date.now();
        return timestamp.toMillis ? timestamp.toMillis() : new Date(timestamp).getTime();
    }

    loadDashboardData() {
        this.isLoading.set(true);
        this.orderService.getOrders().subscribe({
            next: (orders) => {
                this.calculateStats(orders);
                this.recentOrders.set(orders.slice(0, 5)); // Get 5 most recent
                this.isLoading.set(false);
            },
            error: (error: any) => {
                console.error('Error loading dashboard data:', error);
                this.toast.error('Error loading dashboard stats');
                this.isLoading.set(false);
            }
        });
    }

    calculateStats(orders: Order[]) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const stats: DashboardStats = {
            totalOrders: orders.length,
            pendingOrders: orders.filter(o => o.status === 'pending').length,
            processingOrders: orders.filter(o => o.status === 'processing').length,
            shippedToday: orders.filter(o => {
                if (o.status !== 'shipped') return false;
                const orderDate = this.getJsDate(o.updatedAt);
                orderDate.setHours(0, 0, 0, 0);
                return orderDate.getTime() === today.getTime();
            }).length
        };

        this.stats.set(stats);
    }

    getStatusBadgeClass(status: OrderStatus): string {
        const classes: Record<OrderStatus, string> = {
            'pending': 'status-pending',
            'processing': 'status-processing',
            'shipped': 'status-shipped',
            'delivered': 'status-delivered',
            'cancelled': 'status-cancelled',
            'refunded': 'status-refunded',
            'returned': 'status-returned'
        };
        return classes[status] || '';
    }

    formatDate(date: any): string {
        if (!date) return '';
        const d = this.getJsDate(date);
        return d.toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    async loadSLAStats() {
        try {
            const stats = await this.priorityService.getSLAStats();

            // If no priority records exist, calculate from orders directly
            if (stats.total === 0) {
                this.orderService.getOrders().subscribe({
                    next: (orders) => {
                        const now = Date.now();
                        const sixHoursFromNow = now + (6 * 60 * 60 * 1000);

                        // Default SLA: 48 hours for standard priority
                        const defaultSLAHours = 48;

                        let onTime = 0;
                        let overdue = 0;
                        let approaching = 0;

                        orders.forEach(order => {
                            const createdAt = this.getTimestampMillis(order.createdAt);
                            const slaDeadline = createdAt + (defaultSLAHours * 60 * 60 * 1000);

                            if (now > slaDeadline) {
                                overdue++;
                            } else if (slaDeadline <= sixHoursFromNow) {
                                approaching++;
                            } else {
                                onTime++;
                            }
                        });

                        const total = orders.length;
                        const complianceRate = total > 0 ? ((onTime + approaching) / total) * 100 : 100;

                        this.slaStats.set({
                            total,
                            onTime,
                            overdue,
                            approaching,
                            complianceRate: Math.round(complianceRate * 100) / 100
                        });

                        if (this.slaChart) {
                            this.updateSLAChart();
                        }
                    }
                });
            } else {
                this.slaStats.set(stats);
                if (this.slaChart) {
                    this.updateSLAChart();
                }
            }
        } catch (error) {
            console.error('Error loading SLA stats:', error);
            this.toast.error('Error loading SLA validation');
        }
    }

    async loadPriorityStats() {
        try {
            this.orderService.getOrders().subscribe({
                next: (orders) => {
                    const stats: PriorityStats = {
                        standard: orders.filter(o => o.priorityLevel === 'standard').length,
                        express: orders.filter(o => o.priorityLevel === 'express').length,
                        rush: orders.filter(o => o.priorityLevel === 'rush').length
                    };

                    // If no orders have priority levels set, default all to standard
                    const total = stats.standard + stats.express + stats.rush;
                    if (total === 0 && orders.length > 0) {
                        stats.standard = orders.length;
                    }

                    this.priorityStats.set(stats);
                    // Update chart if it exists
                    if (this.priorityChart) {
                        this.updatePriorityChart();
                    }
                }
            });
        } catch (error) {
            console.error('Error loading priority stats:', error);
        }
    }

    async loadStaffWorkload() {
        try {
            this.orderService.getOrders().subscribe({
                next: (orders) => {
                    // Group orders by assigned staff
                    const workloadMap = new Map<string, StaffWorkload>();

                    orders.forEach(order => {
                        if (order.assignedToName) {
                            const existing = workloadMap.get(order.assignedToName) || {
                                staffName: order.assignedToName,
                                assignedOrders: 0,
                                inProgress: 0,
                                completed: 0
                            };

                            existing.assignedOrders++;
                            if (order.status === 'processing') existing.inProgress++;
                            if (order.status === 'shipped' || order.status === 'delivered') existing.completed++;

                            workloadMap.set(order.assignedToName, existing);
                        }
                    });

                    this.staffWorkload.set(Array.from(workloadMap.values()));
                }
            });
        } catch (error) {
            console.error('Error loading staff workload:', error);
            this.toast.error('Error loading staff metrics');
        }
    }

    async loadOverdueOrders() {
        try {
            this.orderService.getOrders().subscribe({
                next: (orders) => {
                    const overdue = orders.filter(o => o.isOverdue && o.status !== 'shipped' && o.status !== 'delivered');
                    this.overdueOrders.set(overdue.slice(0, 5)); // Top 5 overdue
                }
            });
        } catch (error) {
            console.error('Error loading overdue orders:', error);
        }
    }

    getSLAComplianceColor(): string {
        const rate = this.slaStats().complianceRate;
        if (rate >= 90) return '#28a745';
        if (rate >= 75) return '#ffc107';
        return '#dc3545';
    }

    getPriorityColor(priority: 'standard' | 'express' | 'rush'): string {
        switch (priority) {
            case 'standard': return '#667eea';
            case 'express': return '#f5576c';
            case 'rush': return '#fa709a';
            default: return '#6c757d';
        }
    }

    // Chart creation methods
    private createSLAChart() {
        const canvas = document.getElementById('slaChart') as HTMLCanvasElement;
        if (!canvas) return;

        const stats = this.slaStats();
        const config: ChartConfiguration = {
            type: 'pie',
            data: {
                labels: ['On Time', 'Approaching', 'Overdue'],
                datasets: [{
                    data: [stats.onTime, stats.approaching, stats.overdue],
                    backgroundColor: [
                        '#28a745',
                        '#ffc107',
                        '#dc3545'
                    ],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = stats.total || 1;
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        };

        this.slaChart = new Chart(canvas, config);
    }

    private createPriorityChart() {
        const canvas = document.getElementById('priorityChart') as HTMLCanvasElement;
        if (!canvas) return;

        const stats = this.priorityStats();
        const config: ChartConfiguration = {
            type: 'doughnut',
            data: {
                labels: ['Standard', 'Express', 'Rush'],
                datasets: [{
                    data: [stats.standard, stats.express, stats.rush],
                    backgroundColor: [
                        '#667eea',
                        '#f5576c',
                        '#fa709a'
                    ],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                return `${label}: ${value} orders`;
                            }
                        }
                    }
                }
            }
        };

        this.priorityChart = new Chart(canvas, config);
    }

    private createTrendChart() {
        const canvas = document.getElementById('trendChart') as HTMLCanvasElement;
        if (!canvas) return;

        // Get last 7 days of data
        const labels: string[] = [];
        const pendingData: number[] = [];
        const processingData: number[] = [];
        const shippedData: number[] = [];

        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }));

            // For now, use placeholder data
            // In production, you'd fetch actual historical data
            pendingData.push(Math.floor(Math.random() * 20) + 5);
            processingData.push(Math.floor(Math.random() * 15) + 3);
            shippedData.push(Math.floor(Math.random() * 25) + 10);
        }

        const config: ChartConfiguration = {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Pending',
                        data: pendingData,
                        borderColor: '#ffc107',
                        backgroundColor: 'rgba(255, 193, 7, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Processing',
                        data: processingData,
                        borderColor: '#17a2b8',
                        backgroundColor: 'rgba(23, 162, 184, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Shipped',
                        data: shippedData,
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        };

        this.trendChart = new Chart(canvas, config);
    }

    private updateSLAChart() {
        if (!this.slaChart) return;
        const stats = this.slaStats();
        this.slaChart.data.datasets[0].data = [stats.onTime, stats.approaching, stats.overdue];
        this.slaChart.update();
    }

    private updatePriorityChart() {
        if (!this.priorityChart) return;
        const stats = this.priorityStats();
        this.priorityChart.data.datasets[0].data = [stats.standard, stats.express, stats.rush];
        this.priorityChart.update();
    }
}
