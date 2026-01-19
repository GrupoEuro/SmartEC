import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { trigger, transition, style, animate, state } from '@angular/animations';
import { CartService } from '../../core/services/cart.service';
import { AuthService } from '../../core/services/auth.service';
import { MercadoPagoService } from '../../core/services/mercadopago.service';

@Component({
    selector: 'app-checkout',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule],
    template: `
        <div class="checkout-container">
            <div class="checkout-grid">
                
                <!-- Left Column: Steps -->
                <div class="steps-column">
                    
                    <!-- STEP 1: IDENTITY -->
                    <div class="step-card" [class.active]="currentStep() === 1" [class.completed]="currentStep() > 1">
                        <div class="step-header" (click)="setStep(1)">
                            <div class="step-number">1</div>
                            <h3>{{ 'CHECKOUT.IDENTITY' | translate }}</h3>
                            @if (currentStep() > 1) {
                                <span class="check-icon">✓</span>
                                <span class="summary-text">{{ emailControl.value }}</span>
                            }
                        </div>
                        <div class="step-content" [@expandCollapse]="currentStep() === 1 ? 'expanded' : 'collapsed'">
                            <p class="step-intro">Checkout as Guest or Login for faster checkout.</p>
                            
                            <div class="form-group">
                                <label>Email Address</label>
                                <input type="email" [formControl]="emailControl" placeholder="name@example.com" class="form-input">
                                @if (emailControl.touched && emailControl.invalid) {
                                    <span class="error">Valid email is required.</span>
                                }
                            </div>

                            <button class="btn-primary" [disabled]="emailControl.invalid" (click)="nextStep()">
                                Continue to Shipping
                            </button>

                            <div class="auth-divider">
                                <span>OR</span>
                            </div>
                            <button class="btn-google" (click)="loginWithGoogle()">
                                <img src="assets/icons/google.svg" alt="G" style="width: 20px;">
                                Sign in with Google
                            </button>
                        </div>
                    </div>

                    <!-- STEP 2: SHIPPING -->
                    <div class="step-card" [class.active]="currentStep() === 2" [class.completed]="currentStep() > 2">
                        <div class="step-header" (click)="currentStep() > 2 ? setStep(2) : null">
                            <div class="step-number">2</div>
                            <h3>{{ 'CHECKOUT.SHIPPING' | translate }}</h3>
                        </div>
                        <div class="step-content" [@expandCollapse]="currentStep() === 2 ? 'expanded' : 'collapsed'">
                            <form [formGroup]="shippingForm">
                                <div class="form-row">
                                    <div class="form-group half">
                                        <label>{{ 'CHECKOUT.FIRST_NAME' | translate }}</label>
                                        <input formControlName="firstName" class="form-input">
                                    </div>
                                    <div class="form-group half">
                                        <label>{{ 'CHECKOUT.LAST_NAME' | translate }}</label>
                                        <input formControlName="lastName" class="form-input">
                                    </div>
                                </div>
                                
                                <!-- Street & Numbers -->
                                <div class="form-row">
                                    <div class="form-group" style="flex: 2;">
                                        <label>{{ 'CHECKOUT.STREET' | translate }}</label>
                                        <input formControlName="street" class="form-input" [placeholder]="'CHECKOUT.STREET_PLACEHOLDER' | translate">
                                    </div>
                                    <div class="form-group" style="flex: 0.5;">
                                        <label>{{ 'CHECKOUT.EXT_NUM' | translate }}</label>
                                        <input formControlName="extNum" class="form-input">
                                    </div>
                                    <div class="form-group" style="flex: 0.5;">
                                        <label>{{ 'CHECKOUT.INT_NUM' | translate }}</label>
                                        <input formControlName="intNum" class="form-input" placeholder="Op.">
                                    </div>
                                </div>

                                <!-- Colonia & Zip -->
                                <div class="form-row">
                                    <div class="form-group half">
                                        <label>{{ 'CHECKOUT.COLONIA' | translate }}</label>
                                        <input formControlName="colonia" class="form-input">
                                    </div>
                                    <div class="form-group half">
                                        <label>{{ 'CHECKOUT.ZIP' | translate }}</label>
                                        <input formControlName="zip" class="form-input">
                                    </div>
                                </div>

                                <!-- City & State -->
                                <div class="form-row">
                                    <div class="form-group half">
                                        <label>{{ 'CHECKOUT.CITY' | translate }}</label>
                                        <input formControlName="city" class="form-input">
                                    </div>
                                    <div class="form-group half">
                                        <label>{{ 'CHECKOUT.STATE' | translate }}</label>
                                        <input formControlName="state" class="form-input">
                                    </div>
                                </div>

                                <div class="form-group">
                                    <label>{{ 'CHECKOUT.PHONE' | translate }}</label>
                                    <input formControlName="phone" class="form-input" placeholder="55 1234 5678">
                                </div>
                            </form>

                            <button class="btn-primary" [disabled]="shippingForm.invalid" (click)="nextStep()">
                                {{ 'CHECKOUT.CONTINUE_PAYMENT' | translate }}
                            </button>
                        </div>
                    </div>

                    <!-- STEP 3: PAYMENT -->
                    <div class="step-card" [class.active]="currentStep() === 3">
                        <div class="step-header">
                            <div class="step-number">3</div>
                            <h3>{{ 'CHECKOUT.PAYMENT' | translate }}</h3>
                        </div>
                        <div class="step-content" [@expandCollapse]="currentStep() === 3 ? 'expanded' : 'collapsed'">
                            <div class="payment-placeholder">
                                <p>Secure Payment via <strong>MercadoPago</strong></p>
                                <div class="trust-badges">
                                    <span>🔒 SSL Encrypted</span>
                                    <span>🛡️ Fraud Protection</span>
                                </div>
                                
                                <div id="wallet_container"></div> <!-- MERCADOPAGO MOUNT POINT -->
                                
                                <button class="btn-pay" (click)="processPayment()">
                                    Pay {{ cartService.cartSubtotal() | currency }}
                                </button>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- Right Column: Order Summary -->
                <div class="summary-column">
                    <div class="summary-card">
                        <h3>Order Summary</h3>
                        <div class="summary-items">
                            @for (item of cartService.cartItems(); track item.product.id) {
                                <div class="summary-item">
                                    <div class="item-img-wrapper" style="position: relative;">
                                        <img [src]="item.product.images.main || 'assets/placeholder_tire.png'" alt="prod">
                                        <span class="qty-badge">{{ item.quantity }}</span>
                                    </div>
                                    <div class="item-info">
                                        <p class="name">{{ item.product.name.en }}</p>
                                        <p class="price">{{ item.product.price | currency }}</p>
                                    </div>
                                </div>
                            }
                        </div>
                        <div class="summary-totals">
                            <div class="row">
                                <span>Subtotal</span>
                                <span>{{ cartService.cartSubtotal() | currency }}</span>
                            </div>
                            <div class="row">
                                <span>Shipping</span>
                                @if (cartService.amountToFreeShipping() <= 0) {
                                    <span class="free">Free</span>
                                } @else {
                                    <span>Calculated next step</span>
                                }
                            </div>
                            <div class="divider"></div>
                            <div class="row total">
                                <span>Total</span>
                                <span>{{ cartService.cartSubtotal() | currency }}</span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    `,
    styles: [`
        .checkout-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }
        .checkout-grid {
            display: grid;
            grid-template-columns: 1fr 380px;
            gap: 40px;
        }
        @media (max-width: 900px) {
            .checkout-grid { grid-template-columns: 1fr; }
            .summary-column { order: -1; margin-bottom: 20px; }
        }

        /* STEPS */
        .step-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
            transition: all 0.3s;
        }
        .step-card.active {
            border-color: var(--theme-primary, #2563eb);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .step-header {
            padding: 20px;
            display: flex;
            align-items: center;
            cursor: pointer;
            background: #fff;
        }
        .step-number {
            width: 32px;
            height: 32px;
            background: #e2e8f0;
            color: #64748b;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            margin-right: 15px;
        }
        .step-card.active .step-number {
            background: var(--theme-primary, #2563eb);
            color: white;
        }
        .step-card.completed .step-number {
            background: var(--green, #10b981);
            color: white;
        }
        .check-icon { color: var(--green, #10b981); margin-right: 10px; font-weight: bold; }
        
        .step-content {
            padding: 0 20px 20px 20px;
            border-top: 1px solid #f1f5f9;
        }

        /* FORMS */
        .form-group { margin-bottom: 15px; }
        .form-row { display: flex; gap: 15px; }
        .half { flex: 1; }
        .quarter { flex: 0.25; }
        label { display: block; margin-bottom: 5px; font-size: 0.9rem; font-weight: 500; color: #475569; }
        .form-input {
            width: 100%;
            padding: 10px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            font-size: 1rem;
        }
        .form-input:focus { outline: none; border-color: var(--theme-primary); }
        
        .btn-primary {
            width: 100%;
            padding: 14px;
            background: var(--theme-primary, #2563eb);
            color: white;
            border: none;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            margin-top: 10px;
        }
        .btn-primary:disabled { background: #cbd5e1; cursor: not-allowed; }

        .auth-divider { text-align: center; margin: 20px 0; position: relative; }
        .auth-divider::before {
            content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: #e2e8f0; z-index: 0;
        }
        .auth-divider span { background: white; padding: 0 10px; position: relative; z-index: 1; color: #64748b; font-size: 0.9rem; }

        .btn-google {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 12px;
            background: white;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
        }

        .btn-pay {
            width: 100%;
            padding: 16px;
            background: var(--theme-primary, #2563eb);
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 1.1rem;
            cursor: pointer;
            margin-top: 20px;
        }

        /* SUMMARY */
        .summary-card {
            background: #f8fafc;
            padding: 24px;
            border-radius: 8px;
            position: sticky;
            top: 100px;
        }
        .summary-item { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
        .item-img-wrapper img { width: 64px; height: 64px; object-fit: contain; background: white; border-radius: 6px; border: 1px solid #e2e8f0; }
        .qty-badge {
            position: absolute; top: -8px; right: -8px; background: #64748b; color: white;
            border-radius: 50%; width: 20px; height: 20px; font-size: 0.75rem;
            display: flex; align-items: center; justify-content: center;
        }
        .summary-totals .row { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .divider { height: 1px; background: #e2e8f0; margin: 15px 0; }
        .total { font-weight: bold; font-size: 1.2rem; }
    `],
    animations: [
        trigger('expandCollapse', [
            state('collapsed', style({ height: '0px', padding: '0 20px', opacity: 0, visibility: 'hidden' })),
            state('expanded', style({ height: '*', padding: '0 20px 20px 20px', opacity: 1, visibility: 'visible' })),
            transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0.0, 0.2, 1)'))
        ])
    ]
})
export class CheckoutComponent {
    cartService = inject(CartService);
    authService = inject(AuthService);
    router = inject(Router);
    fb = inject(FormBuilder);
    mpService = inject(MercadoPagoService);

    currentStep = signal(1);

    // Forms
    emailControl = this.fb.control('', [Validators.required, Validators.email]);

    shippingForm = this.fb.group({
        firstName: ['', Validators.required],
        lastName: ['', Validators.required],
        street: ['', Validators.required],
        extNum: ['', Validators.required],
        intNum: [''],
        colonia: ['', Validators.required],
        city: ['', Validators.required],
        state: ['', Validators.required],
        zip: ['', Validators.required],
        phone: ['', Validators.required]
    });

    constructor() {
        // Pre-fill if logged in
        const user = this.authService.currentUser();
        if (user) {
            this.emailControl.setValue(user.email || '');
            if (this.currentStep() === 1) this.currentStep.set(2);
        }
    }

    setStep(step: number) {
        // Validation/Guard logic can go here
        this.currentStep.set(step);
    }

    nextStep() {
        this.currentStep.update(s => s + 1);
    }

    async loginWithGoogle() {
        await this.authService.loginWithGoogle();
        // If successful, authService.currentUser() updates, constructor logic handles pre-fill? 
        // Not reactive unless in effect.
        // For now user stays on page? Auth service redirects usually. 
        // We might need to override redirect logic or just let them return.
    }

    processPayment() {
        console.log('Processing payment via MercadoPago...');
        // Simulate API delay
        setTimeout(() => {
            this.cartService.clearCart(); // Clear cart on success
            this.router.navigate(['/order-confirmation']);
        }, 1500);
    }
}
