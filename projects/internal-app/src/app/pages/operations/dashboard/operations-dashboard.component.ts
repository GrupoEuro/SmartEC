import { Component, inject, OnInit, OnDestroy, AfterViewInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
    monthlySales: number;
    monthlyPiecesSold: number;
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
    imports: [CommonModule, RouterModule, FormsModule, TranslateModule, AdminPageHeaderComponent, AppIconComponent],
    templateUrl: './operations-dashboard.component.html',
    styleUrls: ['./operations-dashboard.component.css']
})
export class OperationsDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
    private orderService = inject(OrderService);
    private priorityService = inject(OrderPriorityService);
    private assignmentService = inject(OrderAssignmentService);
    private toast = inject(ToastService);
    private translate = inject(TranslateService);

    timeframe = signal<'MTD' | 'YTD'>('MTD');
    channelFilter = signal<'ALL' | 'mercadolibre' | 'web' | 'pos'>('ALL');
    allFetchedOrders: Order[] = [];

    stats = signal<DashboardStats>({
        totalOrders: 0,
        pendingOrders: 0,
        processingOrders: 0,
        shippedToday: 0,
        monthlySales: 0,
        monthlyPiecesSold: 0
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
    }

    ngAfterViewInit() {
        // Initialization moved to after data loads to prevent race conditions
        // with the @if (!isLoading()) block in the template.
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

    setTimeframe(tf: 'MTD' | 'YTD') {
        if (this.timeframe() !== tf) {
            this.timeframe.set(tf);
            this.loadDashboardData();
        }
    }

    setChannelFilter(filter: 'ALL' | 'mercadolibre' | 'web' | 'pos') {
        if (this.channelFilter() !== filter) {
            this.channelFilter.set(filter);
            this.applyFilters();
        }
    }

    loadDashboardData() {
        this.isLoading.set(true);

        const today = new Date();
        const endDate = new Date(today);
        endDate.setHours(23, 59, 59, 999);

        let startDate: Date;
        if (this.timeframe() === 'MTD') {
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        } else {
            startDate = new Date(today.getFullYear(), 0, 1);
        }

        this.orderService.getOrdersByDateRange(startDate, endDate).subscribe({
            next: (orders) => {
                this.allFetchedOrders = orders;
                this.applyFilters();
                this.isLoading.set(false);
            },
            error: (error: any) => {
                console.error('Error loading dashboard data:', error);
                this.toast.error(this.translate.instant('OPERATIONS.DASHBOARD.ERROR_LOADING'));
                this.isLoading.set(false);
            }
        });
    }

    private chartRenderTimeout: any;

    applyFilters() {
        const filter = this.channelFilter();
        let filteredOrders = this.allFetchedOrders;
        
        if (filter !== 'ALL') {
            filteredOrders = this.allFetchedOrders.filter(o => o.sourceChannel === filter);
        }

        this.calculateStats(filteredOrders);
        this.calculateSLAStats(filteredOrders);
        this.calculatePriorityStats(filteredOrders);
        this.calculateStaffWorkload(filteredOrders);
        this.calculateOverdueOrders(filteredOrders);

        this.recentOrders.set(filteredOrders.slice(0, 5));

        if (this.chartRenderTimeout) {
            clearTimeout(this.chartRenderTimeout);
        }

        this.chartRenderTimeout = setTimeout(() => {
            if (document.getElementById('trendChart')) {
                this.createSLAChart();
                this.createPriorityChart();
                this.createTrendChart(filteredOrders);
            }
        }, 150);
    }

    calculateStats(orders: Order[]) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let sales = 0;
        let piecesSold = 0;
        let totalOrders = orders.length;
        let pendingOrders = 0;
        let processingOrders = 0;

        orders.forEach(o => {
            if (o.status === 'pending') pendingOrders++;
            if (o.status === 'processing') processingOrders++;

            // Ignore cancelled and refunded orders for the sales calculation
            if (o.status !== 'cancelled' && o.status !== 'refunded' && o.status !== 'returned') {
                sales += o.total || 0;
                if (o.items && Array.isArray(o.items)) {
                    o.items.forEach(item => {
                        piecesSold += item.quantity || 0;
                    });
                }
            }
        });

        const stats: DashboardStats = {
            totalOrders,
            pendingOrders,
            processingOrders,
            shippedToday: orders.filter(o => {
                if (o.status !== 'shipped') return false;
                const orderDate = this.getJsDate(o.updatedAt);
                orderDate.setHours(0, 0, 0, 0);
                return orderDate.getTime() === today.getTime();
            }).length,
            monthlySales: sales, // Kept property name for interface stability, represents active timeframe
            monthlyPiecesSold: piecesSold
        };

        this.stats.set(stats);
        
        // Populate specific widget stats respecting timeframe
        // These are now called directly from applyFilters
        // this.calculateSLAStats(orders);
        // this.calculatePriorityStats(orders);
        // this.calculateStaffWorkload(orders);
        // this.calculateOverdueOrders(orders);
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

    async calculateSLAStats(orders: Order[]) {
        try {
            let startDate = new Date();
            let endDate = new Date();
            if (orders.length > 0) {
                // Since orders are pre-sorted by date in the UI, we can just grab bounds
                const dates = orders.map(o => this.getTimestampMillis(o.createdAt || o.updatedAt));
                startDate = new Date(Math.min(...dates));
                endDate = new Date(Math.max(...dates));
            } else {
                 if (this.timeframe() === 'MTD') {
                     startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
                 } else {
                     startDate = new Date(startDate.getFullYear(), 0, 1);
                 }
            }

            // Fetch any custom SLA overrides (like rush/express upgrades) applied to orders in this timeframe
            const priorityOverridesMap = await this.priorityService.getSLAOverridesMap(startDate, endDate);
            
            const now = Date.now();
            const sixHoursFromNow = now + (6 * 60 * 60 * 1000);
            
            let onTime = 0;
            let overdue = 0;
            let approaching = 0;
            let validOrdersForSLA = 0;

            orders.forEach(order => {
                // Ignore cancelled, refunded, or returned orders entirely from SLA compliance
                if (['cancelled', 'refunded', 'returned'].includes(order.status)) {
                    return;
                }
                
                validOrdersForSLA++;

                let slaDeadline: number;
                
                // 1. Check for custom priority override from the database
                if (order.id && priorityOverridesMap.has(order.id)) {
                    slaDeadline = priorityOverridesMap.get(order.id)!;
                }
                // 2. Check for native marketplace SLA (e.g. MercadoLibre handling time)
                // @ts-ignore
                else if (order.nativeSla) {
                    // @ts-ignore
                    slaDeadline = this.getTimestampMillis(order.nativeSla);
                } 
                // 3. Fallback to standard 48/72 timeframe based on priority tier
                else {
                    const defaultSLAHours = order.priorityLevel === 'rush' ? 24 : (order.priorityLevel === 'express' ? 48 : 72);
                    const createdAt = this.getTimestampMillis(order.createdAt);
                    slaDeadline = createdAt + (defaultSLAHours * 60 * 60 * 1000);
                }

                // If order was fulfilled by the platform directly (MeLi Full, Amazon FBA), don't penalize our warehouse SLA
                if (order.fulfillmentType === 'platform') {
                    onTime++;
                    return;
                }

                // If order is already completed, compare the deadline against when it was actually shipped/delivered
                if (['shipped', 'delivered'].includes(order.status)) {
                    let completionTime: number;
                    let shippedEvent = null;

                    if (order.history && Array.isArray(order.history)) {
                        // Find the first time it was marked shipped or delivered
                        shippedEvent = order.history.find(h => h.status === 'shipped' || h.status === 'delivered');
                    }

                    if (shippedEvent && shippedEvent.timestamp) {
                        completionTime = this.getTimestampMillis(shippedEvent.timestamp);
                    } else if (order.shipments && order.shipments.length > 0 && order.shipments[0].shippedDate) {
                        completionTime = this.getTimestampMillis(order.shipments[0].shippedDate);
                    } else {
                        completionTime = this.getTimestampMillis(order.updatedAt || order.createdAt);
                    }

                    if (completionTime > slaDeadline) {
                        overdue++;
                    } else {
                        onTime++;
                    }
                } else {
                    // For active orders, compare against current time
                    if (now > slaDeadline) {
                        overdue++;
                    } else if (slaDeadline <= sixHoursFromNow) {
                        approaching++;
                    } else {
                        onTime++;
                    }
                }
            });

            const complianceRate = validOrdersForSLA > 0 ? ((onTime + approaching) / validOrdersForSLA) * 100 : 100;

            this.slaStats.set({
                total: validOrdersForSLA,
                onTime,
                overdue,
                approaching,
                complianceRate: Math.round(complianceRate * 100) / 100
            });

            if (this.slaChart) {
                this.updateSLAChart();
            }
        } catch (error) {
            console.error('Error calculating SLA stats:', error);
            this.toast.error('Error calculating SLA validation');
        }
    }

    calculatePriorityStats(orders: Order[]) {
        try {
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
        } catch (error) {
            console.error('Error calculating priority stats:', error);
        }
    }

    calculateStaffWorkload(orders: Order[]) {
        try {
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
        } catch (error) {
            console.error('Error calculating staff workload:', error);
            this.toast.error('Error calculating staff metrics');
        }
    }

    calculateOverdueOrders(orders: Order[]) {
        try {
            // Re-evaluate overdue locally to match SLA chart computation instead of relying on the DB flag
            const now = Date.now();
            const overdue = orders.filter(o => {
                if (o.status === 'shipped' || o.status === 'delivered' || o.status === 'cancelled' || o.status === 'returned' || o.status === 'refunded') return false;
                
                let slaDeadline: number;
                // @ts-ignore
                if (o.nativeSla) {
                    // @ts-ignore
                    slaDeadline = this.getTimestampMillis(o.nativeSla);
                } else {
                    const defaultSLAHours = o.priorityLevel === 'rush' ? 24 : (o.priorityLevel === 'express' ? 48 : 72);
                    const createdAt = this.getTimestampMillis(o.createdAt);
                    slaDeadline = createdAt + (defaultSLAHours * 60 * 60 * 1000);
                }
                
                return now > slaDeadline;
            });
            this.overdueOrders.set(overdue.slice(0, 5)); // Top 5 overdue
        } catch (error) {
            console.error('Error calculating overdue orders:', error);
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
                labels: [
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.ON_TIME'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.APPROACHING'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.OVERDUE')
                ],
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
                labels: [
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.STANDARD'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.EXPRESS'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.RUSH')
                ],
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
                                return `${label}: ${value} pedidos`;
                            }
                        }
                    }
                }
            }
        };

        this.priorityChart = new Chart(canvas, config);
    }

    private createTrendChart(orders: Order[]) {
        const canvas = document.getElementById('trendChart') as HTMLCanvasElement;
        if (!canvas) return;

        // Destroy existing instance to prevent chart overlap when toggling timeframes
        if (this.trendChart) {
            this.trendChart.destroy();
        }

        const today = new Date();
        const currentYear = today.getFullYear();

        const labels: string[] = [];
        let dataLength = 0;
        let getIndexFn: (d: Date) => number;

        if (this.timeframe() === 'MTD') {
            const currentMonth = today.getMonth();
            const daysInMonth = today.getDate(); // 1 to today's date
            dataLength = daysInMonth;

            for (let i = 1; i <= daysInMonth; i++) {
                const date = new Date(currentYear, currentMonth, i);
                labels.push(date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }));
            }
            getIndexFn = (d: Date) => d.getDate() - 1;
        } else {
            // YTD Logic
            const currentMonthIndex = today.getMonth(); // 0 to today's month
            dataLength = currentMonthIndex + 1;

            for (let i = 0; i <= currentMonthIndex; i++) {
                const date = new Date(currentYear, i, 1);
                let monthStr = date.toLocaleDateString('es-MX', { month: 'short' });
                labels.push(monthStr.charAt(0).toUpperCase() + monthStr.slice(1));
            }
            getIndexFn = (d: Date) => d.getMonth();
        }

        const pendingData: number[] = new Array(dataLength).fill(0);
        const processingData: number[] = new Array(dataLength).fill(0);
        const shippedData: number[] = new Array(dataLength).fill(0);
        const deliveredData: number[] = new Array(dataLength).fill(0);
        const cancelledData: number[] = new Array(dataLength).fill(0);
        const salesData: number[] = new Array(dataLength).fill(0);

        orders.forEach(o => {
            const orderDate = this.getJsDate(o.createdAt || o.updatedAt);
            const index = getIndexFn(orderDate);

            if (index >= 0 && index < dataLength) {
                if (o.status === 'pending') pendingData[index]++;
                else if (o.status === 'processing') processingData[index]++;
                else if (o.status === 'shipped') shippedData[index]++;
                else if (o.status === 'delivered') deliveredData[index]++;
                else if (o.status === 'cancelled' || o.status === 'refunded' || o.status === 'returned') cancelledData[index]++;

                if (o.status !== 'cancelled' && o.status !== 'refunded' && o.status !== 'returned' && o.status !== 'invalid') {
                    salesData[index] += o.total || 0;
                }
            }
        });

        const config: ChartConfiguration = {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'line',
                        label: 'Net Sales ($)',
                        data: salesData,
                        borderColor: '#2dd4bf', // teal-400
                        backgroundColor: '#2dd4bf',
                        tension: 0.4,
                        yAxisID: 'y1',
                        borderWidth: 3,
                        pointBackgroundColor: '#2dd4bf',
                        pointBorderColor: '#fff',
                        pointRadius: 4,
                        order: 0
                    },
                    {
                        type: 'bar',
                        label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.PENDING'),
                        data: pendingData,
                        backgroundColor: '#ffc107',
                        borderWidth: 0,
                        order: 1,
                        yAxisID: 'y'
                    },
                    {
                        type: 'bar',
                        label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.PROCESSING'),
                        data: processingData,
                        backgroundColor: '#17a2b8',
                        borderWidth: 0,
                        order: 1,
                        yAxisID: 'y'
                    },
                    {
                        type: 'bar',
                        label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.SHIPPED'),
                        data: shippedData,
                        backgroundColor: '#8b5cf6', // Purple/Violet to distinguish from Delivered
                        borderWidth: 0,
                        order: 1,
                        yAxisID: 'y'
                    },
                    {
                        type: 'bar',
                        label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.DELIVERED'),
                        data: deliveredData,
                        backgroundColor: '#10b981', // Emerald Green
                        borderWidth: 0,
                        order: 1,
                        yAxisID: 'y'
                    },
                    {
                        type: 'bar',
                        label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.CANCELLED_RETURNED'),
                        data: cancelledData,
                        backgroundColor: '#dc3545', // Danger Red
                        borderWidth: 0,
                        order: 1,
                        yAxisID: 'y'
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
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.dataset.type === 'line') {
                                    label += new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(context.parsed.y);
                                } else {
                                    label += context.parsed.y;
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        stacked: true,
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        grid: { drawOnChartArea: false },
                        ticks: {
                            callback: function(value) {
                                return '$' + (Number(value) / 1000).toFixed(0) + 'k';
                            }
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
