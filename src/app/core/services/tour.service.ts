import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { driver, Driver } from 'driver.js';
import { TranslateService } from '@ngx-translate/core';

export interface TourStep {
    element: string; // CSS Selector
    popover: {
        title: string;
        description: string;
        side?: 'left' | 'right' | 'top' | 'bottom';
        align?: 'start' | 'center' | 'end';
    };
}

export interface TourDefinition {
    id: string;
    steps: TourStep[];
    route?: string; // Route to navigate to before starting
}

@Injectable({
    providedIn: 'root'
})
export class TourService {
    private router = inject(Router);
    private translate = inject(TranslateService);
    private driverObj: Driver | null = null;

    // Tour Definitions
    private tours: Record<string, TourDefinition> = {
        'inventory-receiving': {
            id: 'inventory-receiving',
            route: '/operations/inventory',
            steps: [
                {
                    element: '#inventory-header',
                    popover: {
                        title: 'Inventory Lookup',
                        description: 'This is your central hub for checking stock levels across all warehouses.',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: '#inventory-search',
                    popover: {
                        title: 'Search Products',
                        description: 'Quickly find items by SKU, Name, or Brand. Try typing "Michelin".',
                        side: 'bottom'
                    }
                },
                {
                    element: '#inventory-filters',
                    popover: {
                        title: 'Filter Stock',
                        description: 'Use these dropdowns to see only "Low Stock" or specific Brands.',
                        side: 'bottom'
                    }
                },
                {
                    element: '#inventory-export',
                    popover: {
                        title: 'Export Data',
                        description: 'Download the current view as a CSV for Excel analysis.',
                        side: 'left'
                    }
                },
                {
                    element: '#inventory-help-btn',
                    popover: {
                        title: 'Need More Help?',
                        description: 'Click this button anytime to view the full "Receiving Guide" or "SOPs".',
                        side: 'left'
                    }
                }
            ]
        },
        'command-center-orientation': {
            id: 'command-center-orientation',
            route: '/command-center',
            steps: [
                {
                    element: '#cc-header',
                    popover: {
                        title: 'Command Center',
                        description: 'This is your central hub for operations. Monitor operational health, financials, and inventory in real-time.',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: '#cc-global-search',
                    popover: {
                        title: 'Global Search',
                        description: 'Quickly find orders, products, or customers. Press ⌘K to focus.',
                        side: 'bottom'
                    }
                },
                {
                    element: '#cc-date-range',
                    popover: {
                        title: 'Time Travel',
                        description: 'Filter all dashboards by date. Use the Custom option for specific ranges.',
                        side: 'bottom'
                    }
                },
                {
                    element: '#cc-widgets',
                    popover: {
                        title: 'Smart Widgets',
                        description: 'Key metrics at a glance. Drill down by clicking on any widget card.',
                        side: 'top'
                    }
                }
            ]
        },
        'customer-insights-tour': {
            id: 'customer-insights-tour',
            route: '/command-center/customer-insights',
            steps: [
                {
                    element: '#ci-header',
                    popover: {
                        title: 'Customer Insights',
                        description: 'Deep dive into customer behavior, retention, and loyalty segments.',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: '#ci-rfm-analysis',
                    popover: {
                        title: 'RFM Analysis',
                        description: 'Recency, Frequency, Monetary value. This grid segments your customers based on purchase behavior.',
                        side: 'bottom'
                    }
                },
                {
                    element: '#ci-rfm-actions',
                    popover: {
                        title: 'Segment Info',
                        description: 'Click "Info" to see definitions of Champions, Loyalists, and At Risk customers.',
                        side: 'left'
                    }
                },
                {
                    element: '#ci-retention',
                    popover: {
                        title: 'Retention Heatmap',
                        description: 'Track how many customers return month over month. Darker green means higher retention.',
                        side: 'top'
                    }
                },
                {
                    element: '#ci-clv',
                    popover: {
                        title: 'Customer Lifetime Value',
                        description: 'Metrics showing the long-term value of your customer base.',
                        side: 'top'
                    }
                }
            ]
        }
    };

    startTour(tourId: string) {
        const tour = this.tours[tourId];
        if (!tour) {
            console.warn(`Tour ${tourId} not found`);
            return;
        }

        if (tour.route && this.router.url !== tour.route) {
            this.router.navigate([tour.route]).then(() => {
                // Wait for navigation and DOM render
                setTimeout(() => this.runDriver(tour), 500);
            });
        } else {
            this.runDriver(tour);
        }
    }

    private runDriver(tour: TourDefinition) {
        const steps = tour.steps.map(step => ({
            element: step.element,
            popover: {
                title: step.popover.title,
                description: step.popover.description,
                side: step.popover.side || 'bottom',
                align: step.popover.align || 'start'
            }
        }));

        this.driverObj = driver({
            showProgress: true,
            animate: true,
            steps: steps,
            onDestroyStarted: () => {
                if (!this.driverObj?.hasNextStep() || confirm("Are you sure you want to exit the tour?")) {
                    this.driverObj?.destroy();
                }
            }
        });

        this.driverObj.drive();
    }
}
