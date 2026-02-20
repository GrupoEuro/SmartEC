import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';

import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { OrderService } from '../../../../core/services/order.service';
import { ProductService } from '../../../../core/services/product.service';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { ToastService } from '../../../../core/services/toast.service';
import { UserProfile } from '../../../../core/models/user.model';
import { Product } from '../../../../core/models/product.model';
import { Order, OrderItem, ShippingAddress } from '../../../../core/models/order.model';

@Component({
    selector: 'app-order-builder',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslateModule, AppIconComponent, AdminPageHeaderComponent],
    templateUrl: './order-builder.component.html',
    styles: [`
        .order-builder-grid {
            display: grid;
            grid-template-columns: 1fr 350px;
            gap: 1.5rem;
            height: calc(100vh - 180px); /* Approximate viewport height minus header */
        }
        @media (max-width: 1024px) {
            .order-builder-grid {
                grid-template-columns: 1fr;
                height: auto;
            }
        }
        /* Custom Scrollbar for products list */
        .product-list {
            @apply overflow-y-auto pr-2;
            max-height: 400px;
        }
    `]
})
export class OrderBuilderComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private orderService = inject(OrderService);
    private productService = inject(ProductService);
    private userService = inject(UserManagementService);
    private toast = inject(ToastService);

    // Context
    customerId = '';
    customer = signal<UserProfile | null>(null);
    isLoadingCustomer = signal(false);

    // Product Search
    searchControl = new FormControl('');
    searchResults = signal<Product[]>([]);
    isSearching = signal(false);

    // Customer Search
    customerSearchControl = new FormControl('');
    customerSearchResults = signal<UserProfile[]>([]);
    isSearchingCustomer = signal(false);

    // Cart State
    cartItems = signal<OrderItem[]>([]);

    // Totals (Computed)
    subtotal = computed(() => this.cartItems().reduce((acc, item) => acc + item.subtotal, 0));
    tax = computed(() => this.subtotal() * 0.16); // 16% IVA Hardcoded for now
    total = computed(() => this.subtotal() + this.tax()); // Add shipping later

    // Shipping
    shippingCost = signal(0);
    shippingAddress = signal<ShippingAddress | null>(null);

    // UI
    isSubmitting = signal(false);

    constructor() {
        // Product Search Logic
        this.searchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            switchMap(term => {
                if (!term || term.length < 2) return of([]);
                this.isSearching.set(true);
                return this.productService.searchProducts(term); // Assuming this method exists and returns Observable
            })
        ).subscribe({
            next: (products) => {
                this.searchResults.set(products);
                this.isSearching.set(false);
            },
            error: (err) => {
                console.error('Search error', err);
                this.toast.error('Product search failed');
                this.isSearching.set(false);
            }
        });

        // Customer Search Logic
        this.customerSearchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            switchMap(term => {
                if (!term || term.length < 2) return of([]);
                this.isSearchingCustomer.set(true);
                return this.userService.searchCustomers(term);
            })
        ).subscribe({
            next: (customers) => {
                this.customerSearchResults.set(customers);
                this.isSearchingCustomer.set(false);
            },
            error: (err) => {
                console.error('Customer search error', err);
                this.toast.error('Customer search failed');
                this.isSearchingCustomer.set(false);
            }
        });
    }

    ngOnInit() {
        // Check for Customer ID
        this.route.queryParams.subscribe(params => {
            if (params['customerId']) {
                this.customerId = params['customerId'];
                this.loadCustomer(this.customerId);
            }
        });
    }

    loadCustomer(id: string) {
        this.isLoadingCustomer.set(true);
        this.userService.getUserById(id).subscribe({
            next: (user) => {
                if (user) {
                    this.setCustomer(user);
                }
                this.isLoadingCustomer.set(false);
            },
            error: () => this.isLoadingCustomer.set(false)
        });
    }

    setCustomer(user: UserProfile) {
        this.customer.set(user);
        this.customerId = user.uid;

        // Pre-fill Shipping Address
        if (user.shippingAddress) {
            this.shippingAddress.set(user.shippingAddress);
        }

        // Clear search
        this.customerSearchControl.setValue('');
        this.customerSearchResults.set([]);
    }

    // Cart Actions
    addItem(product: Product) {
        // Check if already exists
        const currentItems = this.cartItems();
        const existing = currentItems.find(i => i.productId === product.id);

        if (existing) {
            this.updateQuantity(product.id!, existing.quantity + 1);
        } else {
            const newItem: OrderItem = {
                productId: product.id!,
                productName: product.name['es'],
                productImage: product.images.main || '',
                sku: product.sku,
                price: product.price,
                quantity: 1,
                subtotal: product.price,
                brand: product.brand,
                category: product.categoryId
            };
            this.cartItems.set([...currentItems, newItem]);
        }

        // Clear search
        this.searchControl.setValue('');
        this.searchResults.set([]);
    }

    updateQuantity(productId: string, qty: number) {
        if (qty < 1) return;

        this.cartItems.update(items => items.map(item => {
            if (item.productId === productId) {
                return {
                    ...item,
                    quantity: qty,
                    subtotal: item.price * qty
                };
            }
            return item;
        }));
    }

    removeItem(productId: string) {
        this.cartItems.update(items => items.filter(i => i.productId !== productId));
    }

    // Submit
    async createOrder() {
        const customer = this.customer();
        if (!customer) {
            this.toast.error('Customer is required');
            return;
        }

        if (this.cartItems().length === 0) {
            this.toast.error('Cart is empty');
            return;
        }

        if (!this.shippingAddress()) {
            this.toast.error('Shipping address required');
            return;
        }

        this.isSubmitting.set(true);

        try {
            const orderPayload: Order = {
                orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
                customer: {
                    id: customer.uid,
                    name: customer.displayName || customer.email || 'Guest',
                    email: customer.email,
                    phone: customer.phone || ''
                },
                items: this.cartItems(),
                subtotal: this.subtotal(),
                discount: 0,
                shippingCost: this.shippingCost(),
                tax: this.tax(),
                total: this.total() + this.shippingCost(),
                status: 'pending',
                paymentStatus: 'pending',
                paymentMethod: 'bank_transfer',
                shippingAddress: this.shippingAddress()!,
                createdAt: new Date(),
                updatedAt: new Date(),
                history: [],
                priorityLevel: 'standard'
            };

            const orderId = await this.orderService.createOrder(orderPayload);
            this.toast.success('Order created successfully');

            // Redirect to Order Detail
            this.router.navigate(['/operations/orders', orderId]);
        } catch (error) {
            console.error('Create Order Failed', error);
            this.toast.error('Failed to create order');
            this.isSubmitting.set(false);
        }
    }
}
