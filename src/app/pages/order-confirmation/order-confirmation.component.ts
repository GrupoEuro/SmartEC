import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-order-confirmation',
    standalone: true,
    imports: [CommonModule, RouterLink],
    template: `
        <div class="confirmation-container">
            <div class="success-card">
                <div class="check-circle">✓</div>
                <h1>Order Confirmed!</h1>
                <p class="order-id">Order #ord_123456789</p>
                <p class="message">Thank you for your purchase. We've sent a confirmation email to <strong>email&#64;example.com</strong>.</p>
                
                <div class="actions">
                    <a routerLink="/" class="btn-primary">Return to Home</a>
                    <a routerLink="/track-order" class="btn-secondary">Track Order</a>
                </div>

                <div class="account-prompt">
                    <h3>Save your details for next time?</h3>
                    <p>Create a password to track your order and checkout faster.</p>
                    <div class="password-group">
                        <input type="password" placeholder="Create Password">
                        <button class="btn-create">Create Account</button>
                    </div>
                </div>
            </div>
        </div>
    `,
    styles: [`
        .confirmation-container {
            min-height: 80vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: #f8fafc;
        }
        .success-card {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        .check-circle {
            width: 80px;
            height: 80px;
            background: var(--green, #10b981);
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 3rem;
            margin: 0 auto 20px;
        }
        h1 { margin-bottom: 10px; color: #1e293b; }
        .order-id { font-weight: bold; color: #64748b; margin-bottom: 20px; }
        .message { margin-bottom: 30px; color: #475569; }
        
        .actions { display: flex; gap: 15px; margin-bottom: 30px; }
        .btn-primary { 
            flex: 1; padding: 12px; background: var(--theme-primary, #2563eb); 
            color: white; text-decoration: none; border-radius: 6px; font-weight: bold;
        }
        .btn-secondary { 
            flex: 1; padding: 12px; background: white; border: 1px solid #cbd5e1;
            color: #475569; text-decoration: none; border-radius: 6px; font-weight: bold;
        }

        .account-prompt {
            border-top: 1px solid #e2e8f0;
            padding-top: 20px;
            margin-top: 20px;
        }
        .account-prompt h3 { margin: 0 0 5px; font-size: 1.1rem; }
        .account-prompt p { font-size: 0.9rem; color: #64748b; margin-bottom: 15px; }
        .password-group { display: flex; gap: 10px; }
        .password-group input { flex: 1; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; }
        .btn-create { background: #1e293b; color: white; border: none; padding: 0 20px; border-radius: 6px; cursor: pointer; }
    `]
})
export class OrderConfirmationComponent {
    // Logic to clear cart on init
    cartService = inject(CartService);

    constructor() {
        // Clear cart
        // this.cartService.clearCart(); 
        // Commenting out clearCart for now to avoid losing state during dev testing
    }
}
import { CartService } from '../../core/services/cart.service';
