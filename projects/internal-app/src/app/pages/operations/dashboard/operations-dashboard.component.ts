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
import { GoogleMapsModule, MapMarker, MapInfoWindow } from '@angular/google-maps';
import { ViewChild } from '@angular/core';

// Register Chart.js components
Chart.register(...registerables);

export interface StateMetric {
    name: string;
    lat: number;
    lng: number;
    orders: number;
    pieces: number;
    sales: number;
}

export interface CityGeographicDetail {
    zipCode: string;
    city: string;
    orders: number;
    pieces: number;
    sales: number;
}

export interface StateGeographicDetail {
    state: string;
    orders: number;
    pieces: number;
    sales: number;
    isExpanded?: boolean;
    cities: CityGeographicDetail[];
}

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

const MEXICO_STATES_COORDS: Record<string, { lat: number, lng: number }> = {
    'AGUASCALIENTES': { lat: 21.8853, lng: -102.2916 },
    'BAJA CALIFORNIA': { lat: 30.8406, lng: -115.2838 },
    'BAJA CALIFORNIA SUR': { lat: 26.0444, lng: -111.6661 },
    'CAMPECHE': { lat: 18.8055, lng: -90.2694 },
    'CHIAPAS': { lat: 16.7480, lng: -92.9372 },
    'CHIHUAHUA': { lat: 28.6320, lng: -106.0691 },
    'COAHUILA': { lat: 27.0587, lng: -101.7068 },
    'COLIMA': { lat: 19.1223, lng: -104.0028 },
    'CIUDAD DE MEXICO': { lat: 19.4326, lng: -99.1332 },
    'CDMX': { lat: 19.4326, lng: -99.1332 },
    'DISTRITO FEDERAL': { lat: 19.4326, lng: -99.1332 },
    'DURANGO': { lat: 24.0277, lng: -104.6532 },
    'GUANAJUATO': { lat: 21.0190, lng: -101.2574 },
    'GUERRERO': { lat: 17.5516, lng: -99.5010 },
    'HIDALGO': { lat: 20.0911, lng: -98.7624 },
    'JALISCO': { lat: 20.6595, lng: -103.3490 },
    'ESTADO DE MEXICO': { lat: 19.3268, lng: -99.7042 },
    'MEXICO': { lat: 19.3268, lng: -99.7042 },
    'MICHOCAN': { lat: 19.2274, lng: -101.8311 },
    'MICHOACAN DE OCAMPO': { lat: 19.2274, lng: -101.8311 },
    'MORELOS': { lat: 18.9186, lng: -99.2342 },
    'NAYARIT': { lat: 21.5037, lng: -104.8947 },
    'NUEVO LEON': { lat: 25.5922, lng: -99.9962 },
    'OAXACA': { lat: 17.0732, lng: -96.7266 },
    'PUEBLA': { lat: 19.0414, lng: -98.2063 },
    'QUERETARO': { lat: 20.5888, lng: -100.3899 },
    'QUINTANA ROO': { lat: 19.4447, lng: -87.8227 },
    'SAN LUIS POTOSI': { lat: 22.1565, lng: -100.9855 },
    'SINALOA': { lat: 25.1721, lng: -107.4795 },
    'SONORA': { lat: 29.2972, lng: -110.3309 },
    'TABASCO': { lat: 17.8409, lng: -92.6189 },
    'TAMAULIPAS': { lat: 24.2669, lng: -98.8363 },
    'TLAXCALA': { lat: 19.3139, lng: -98.2411 },
    'VERACRUZ': { lat: 19.1738, lng: -96.1342 },
    'YUCATAN': { lat: 20.9754, lng: -89.6170 },
    'ZACATECAS': { lat: 22.7709, lng: -102.5832 }
};

@Component({
    selector: 'app-operations-dashboard',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TranslateModule, AdminPageHeaderComponent, AppIconComponent, GoogleMapsModule],
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

    // Geographic Map Properties
    heatmapOptions: any = {
        radius: 35,
        opacity: 0.9,
        gradient: [
            'rgba(0, 0, 0, 0)',
            'rgba(30, 215, 96, 1)',   // Spotify Green / Emerald
            'rgba(16, 185, 129, 1)',  // Emerald 500
            'rgba(5, 150, 105, 1)',   // Emerald 600
            'rgba(59, 130, 246, 1)',  // Blue 500
            'rgba(37, 99, 235, 1)',   // Blue 600
            'rgba(147, 51, 234, 1)',  // Purple 600
            'rgba(219, 39, 119, 1)',  // Pink 600
            'rgba(225, 29, 72, 1)',   // Rose 600
            'rgba(244, 63, 94, 1)'    // Rose 500 (Heat apex)
        ]
    };
    rawHeatmapData = signal<{lat: number, lng: number, weight: number}[]>([]);
    
    // Data specifically for interactive tooltips
    stateMetricsSignal = signal<StateMetric[]>([]);
    @ViewChild(MapInfoWindow) infoWindow?: MapInfoWindow;
    activeStateMetric: StateMetric | null = null;
    
    // Geographic Details Table
    showGeographicTable = signal(false);
    stateGeographicDetailsSignal = signal<StateGeographicDetail[]>([]);
    sortColumn = signal<'orders' | 'pieces' | 'sales'>('pieces');
    sortDirection = signal<'asc' | 'desc'>('desc');
    
    mapOptions: any = {
        center: { lat: 23.6345, lng: -102.5528 }, // Center of Mexico
        zoom: 4.8,
        disableDefaultUI: true,
        backgroundColor: '#27272a', // zinc-800
        styles: [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
            { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
            { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
            { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
            { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
            { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
            { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
            { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
            { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
            { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
            { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
        ]
    };

    heatmapDataSignal = signal<any[]>([]);
    
    updateHeatmapSignal() {
        if (typeof google === 'undefined' || !google.maps || !google.maps.LatLng) return;
        const mapped = this.rawHeatmapData().map(raw => ({
            location: new google.maps.LatLng(raw.lat, raw.lng),
            weight: raw.weight
        }));
        this.heatmapDataSignal.set(mapped);
    }

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
        this.generateHeatmapData(filteredOrders);

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

    openInfoWindow(marker: MapMarker, metric: StateMetric) {
        if (this.infoWindow) {
            this.activeStateMetric = metric;
            this.infoWindow.open(marker);
        }
    }

    toggleGeographicTable() {
        this.showGeographicTable.update(v => !v);
    }

    sortGeographicTable(column: 'orders' | 'pieces' | 'sales') {
        if (this.sortColumn() === column) {
            this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortColumn.set(column);
            this.sortDirection.set('desc');
        }
        
        this.applySorting();
    }

    private applySorting() {
        const column = this.sortColumn();
        const direction = this.sortDirection() === 'asc' ? 1 : -1;
        
        this.stateGeographicDetailsSignal.update(states => {
            return [...states].sort((a, b) => {
                const valA = a[column];
                const valB = b[column];
                return (valA - valB) * direction;
            });
        });
    }

    toggleStateRow(stateName: string) {
        this.stateGeographicDetailsSignal.update(states => {
            return states.map(s => {
                if (s.state === stateName) {
                    return { ...s, isExpanded: !s.isExpanded };
                }
                return s;
            });
        });
    }

    private generateHeatmapData(orders: Order[]) {
        const stateCounts: Record<string, { pieces: number, orders: number, sales: number }> = {};
        const stateHierarchies: Record<string, StateGeographicDetail> = {};

        orders.forEach(o => {
            if (o.status === 'cancelled' || o.status === 'returned' || o.status === 'refunded') return;
            
            const state = o.shippingAddress?.state;
            if (!state) return;
            
            // Normalize state name
            const normalizedState = state.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const coords = MEXICO_STATES_COORDS[normalizedState] || MEXICO_STATES_COORDS[normalizedState.replace(' DE OCAMPO', '').replace(' DE ZARAGOZA', '')];
            
            if (coords) {
                const totalPieces = (o.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
                const salesValue = o.total || 0;
                
                if (!stateCounts[normalizedState]) {
                    stateCounts[normalizedState] = { pieces: 0, orders: 0, sales: 0 };
                }
                
                stateCounts[normalizedState].pieces += totalPieces;
                stateCounts[normalizedState].orders += 1;
                stateCounts[normalizedState].sales += salesValue;
                
                // Granular details for the nested expandable table
                const zip = o.shippingAddress?.zipCode || 'N/A';
                const city = o.shippingAddress?.city || 'N/A';
                
                // Initialize State Header if it doesn't exist
                if (!stateHierarchies[normalizedState]) {
                    stateHierarchies[normalizedState] = {
                        state: normalizedState,
                        orders: 0,
                        pieces: 0,
                        sales: 0,
                        isExpanded: false,
                        cities: []
                    };
                }
                
                // Update State Aggregates
                stateHierarchies[normalizedState].pieces += totalPieces;
                stateHierarchies[normalizedState].orders += 1;
                stateHierarchies[normalizedState].sales += salesValue;

                // Update or Initialize City within the State
                let cityEntry = stateHierarchies[normalizedState].cities.find(c => c.city === city && c.zipCode === zip);
                if (!cityEntry) {
                    cityEntry = {
                        city: city,
                        zipCode: zip,
                        orders: 0,
                        pieces: 0,
                        sales: 0
                    };
                    stateHierarchies[normalizedState].cities.push(cityEntry);
                }

                cityEntry.pieces += totalPieces;
                cityEntry.orders += 1;
                cityEntry.sales += salesValue;
            }
        });

        const rawData: any[] = [];
        const stateMetrics: StateMetric[] = [];
        
        Object.keys(stateCounts).forEach(state => {
            const coords = MEXICO_STATES_COORDS[state] || MEXICO_STATES_COORDS[state.replace(' DE OCAMPO', '').replace(' DE ZARAGOZA', '')];
            
            // For the visual heatmap layer
            rawData.push({
                lat: coords.lat,
                lng: coords.lng,
                weight: stateCounts[state].pieces // Heatmap intensity based on pieces sold
            });
            
            // For the interactive tooltips layer
            stateMetrics.push({
                name: state,
                lat: coords.lat,
                lng: coords.lng,
                orders: stateCounts[state].orders,
                pieces: stateCounts[state].pieces,
                sales: stateCounts[state].sales
            });
        });

        this.rawHeatmapData.set(rawData);
        this.stateMetricsSignal.set(stateMetrics);
        
        // Convert to array and sort nested cities inside each state
        const stateArray = Object.values(stateHierarchies).map(stateObj => {
            // Sort nested cities by pieces sold descending always
            stateObj.cities.sort((a, b) => b.pieces - a.pieces);
            return stateObj;
        });

        this.stateGeographicDetailsSignal.set(stateArray);
        this.applySorting(); // Apply initial sorting

        // Update the actual LatLng objects if Google Maps API is ready
        if (typeof google !== 'undefined' && google.maps && google.maps.LatLng) {
            this.updateHeatmapSignal();
        }
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

        // Force native chart destruction
        if (this.slaChart) {
            this.slaChart.destroy();
            this.slaChart = undefined;
        }

        // Hard unmount any ghost instances locked to this canvas ID globally
        for (let id in Chart.instances) {
            const instance = Chart.instances[id];
            if (instance && instance.canvas && instance.canvas.id === 'slaChart') {
                instance.destroy();
            }
        }

        const stats = this.slaStats();
        const config: ChartConfiguration = {
            type: 'doughnut',
            data: {
                labels: [
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.ON_TIME'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.APPROACHING'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.OVERDUE')
                ],
                datasets: [{
                    data: [stats.onTime, stats.approaching, stats.overdue],
                    backgroundColor: [
                        '#10b981', // emerald-500
                        '#f59e0b', // amber-500
                        '#ef4444'  // red-500
                    ],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                // @ts-ignore - Chart.js v3+ typings mismatch, bypass TS2353 crash
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#a1a1aa', // text-zinc-400
                            usePointStyle: true,
                            padding: 20
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

        if (this.priorityChart) {
            this.priorityChart.destroy();
            this.priorityChart = undefined;
        }

        for (let id in Chart.instances) {
            const instance = Chart.instances[id];
            if (instance && instance.canvas && instance.canvas.id === 'priorityChart') {
                instance.destroy();
            }
        }

        const stats = this.priorityStats();
        const config: ChartConfiguration = {
            type: 'bar',
            data: {
                labels: [
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.STANDARD'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.EXPRESS'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.RUSH')
                ],
                datasets: [{
                    label: this.translate.instant('OPERATIONS.DASHBOARD.TOTAL_ORDERS'),
                    data: [stats.standard, stats.express, stats.rush],
                    backgroundColor: [
                        '#3b82f6', // blue-500
                        '#8b5cf6', // violet-500
                        '#ec4899'  // pink-500
                    ],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#3f3f46' // border-zinc-700
                        },
                        ticks: {
                            color: '#a1a1aa' // text-zinc-400
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: '#a1a1aa' // text-zinc-400
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

        if (this.trendChart) {
            this.trendChart.destroy();
            this.trendChart = undefined;
        }

        for (let id in Chart.instances) {
            const instance = Chart.instances[id];
            if (instance && instance.canvas && instance.canvas.id === 'trendChart') {
                instance.destroy();
            }
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
            getIndexFn = (d: Date) => {
                if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
                    return d.getDate() - 1;
                }
                return -1; // Out of bounds
            };
        } else {
            // YTD Logic
            const currentMonthIndex = today.getMonth(); // 0 to today's month
            dataLength = currentMonthIndex + 1;

            for (let i = 0; i <= currentMonthIndex; i++) {
                const date = new Date(currentYear, i, 1);
                let monthStr = date.toLocaleDateString('es-MX', { month: 'short' });
                labels.push(monthStr.charAt(0).toUpperCase() + monthStr.slice(1));
            }
            getIndexFn = (d: Date) => {
                if (d.getFullYear() === currentYear) {
                    return d.getMonth();
                }
                return -1; // Out of bounds
            };
        }

        const pendingData: number[] = new Array(dataLength).fill(0);
        const processingData: number[] = new Array(dataLength).fill(0);
        const shippedData: number[] = new Array(dataLength).fill(0);
        const deliveredData: number[] = new Array(dataLength).fill(0);
        const cancelledData: number[] = new Array(dataLength).fill(0);
        const salesData: number[] = new Array(dataLength).fill(0);

        let debugCount = 0;
        orders.forEach(o => {
            const orderDate = this.getJsDate(o.createdAt || o.updatedAt);
            const index = getIndexFn(orderDate);

            // Isolate parsing logs specifically to January (Month index 0)
            if (orderDate.getMonth() === 0 && debugCount++ < 5) {
                console.log(`Debug YTD Chart [Jan Order] ${o.id}:`, {
                    rawCreatedAt: o.createdAt,
                    parsedDate: orderDate,
                    year: orderDate.getFullYear(),
                    month: orderDate.getMonth(),
                    assignedIndex: index,
                    expectedLength: dataLength
                });
            }

            if (index >= 0 && index < dataLength) {
                if (o.status === 'pending') pendingData[index]++;
                else if (o.status === 'processing') processingData[index]++;
                else if (o.status === 'shipped') shippedData[index]++;
                else if (o.status === 'delivered') deliveredData[index]++;
                else if (o.status === 'cancelled' || o.status === 'refunded' || o.status === 'returned') cancelledData[index]++;

                if (o.status !== 'cancelled' && o.status !== 'refunded' && o.status !== 'returned') {
                    salesData[index] += (o.total || 0);
                }
            }
        });

        // Ensure no NaN values sneak in
        const safeSalesData = salesData.map(val => Number.isNaN(val) ? 0 : val);

        console.log(`Debug YTD Final Payload [Length: ${dataLength}]:`, {
            labels,
            salesData,
            pendingData,
            shippedData,
            deliveredData
        });

        const config: ChartConfiguration = {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'line',
                        label: 'Net Sales ($)',
                        data: safeSalesData,
                        borderColor: '#2dd4bf', // teal-400
                        backgroundColor: '#2dd4bf',
                        tension: 0.4,
                        spanGaps: true,
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
                                    label += new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(context.parsed.y || 0);
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
                        min: 0,
                        suggestedMax: safeSalesData.length > 0 ? (Math.max(...safeSalesData) * 1.25) + 50 : 1000,
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
