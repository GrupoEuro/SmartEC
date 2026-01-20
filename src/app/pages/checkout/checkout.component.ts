import { Component, inject, signal, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
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
    templateUrl: './checkout.component.html',
    styleUrls: ['./checkout.component.css'],
    animations: [
        trigger('expandCollapse', [
            state('collapsed', style({ height: '0px', padding: '0 24px', opacity: 0, visibility: 'hidden' })),
            state('expanded', style({ height: '*', padding: '0 24px 24px 24px', opacity: 1, visibility: 'visible' })),
            transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0.0, 0.2, 1)'))
        ])
    ]
})
export class CheckoutComponent implements AfterViewInit {
    fb = inject(FormBuilder);
    cartService = inject(CartService);
    authService = inject(AuthService);
    mpService = inject(MercadoPagoService);
    router = inject(Router);

    currentStep = signal(1); // 1: Identity, 2: Shipping, 3: Payment

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

    // Payment Form: Only holds data NOT handled by MP Secure Fields
    paymentForm = this.fb.group({
        cardHolder: ['', Validators.required],
        identificationNumber: ['', Validators.required]
    });

    constructor() {
        // Pre-fill if logged in
        const user = this.authService.currentUser();
        if (user) {
            this.emailControl.setValue(user.email || '');
            if (this.currentStep() === 1) {
                // Auto-advance if email is known? Optional
            }
        }
    }

    ngAfterViewInit() {
        // Logic handled in goStep
    }

    setStep(step: number) {
        if (step === 3 && this.currentStep() !== 3) {
            // Delay slightly to ensure DOM is rendered
            setTimeout(() => {
                this.mpService.mountSecureFields({
                    cardNumber: 'form-checkout__cardNumber',
                    expirationDate: 'form-checkout__expirationDate',
                    securityCode: 'form-checkout__securityCode'
                });
            }, 200);
        }
        this.currentStep.set(step);
    }

    // Alias for template usage if needed, or update template to use setStep
    goToStep(step: number) {
        this.setStep(step);
    }

    nextStep() {
        this.setStep(this.currentStep() + 1);
    }

    async loginWithGoogle() {
        await this.authService.loginWithGoogle();
        const user = this.authService.currentUser();
        if (user) {
            this.emailControl.setValue(user.email || '');
            this.setStep(2);
        }
    }

    async processPayment() {
        if (this.paymentForm.invalid) {
            this.paymentForm.markAllAsTouched();
            return;
        }

        const { cardHolder, identificationNumber } = this.paymentForm.value;
        const email = this.emailControl.value || 'guest@importadoraeuro.com';

        try {
            const token = await this.mpService.createToken(cardHolder!, email!, 'INE', identificationNumber!);
            console.log('Payment Token Generated:', token);

            // Here we would call the Backend/Cloud Function to charge the card using the token
            // For now, assume success

            this.router.navigate(['/order-confirmation']);
            this.cartService.clearCart();
        } catch (error) {
            console.error('Payment Failed', error);
            alert('No se pudo procesar el pago. Por favor revise sus datos.');
        }
    }
}
