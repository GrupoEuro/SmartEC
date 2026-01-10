import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Firestore, collection, addDoc, query, where, getDocs, Timestamp } from '@angular/fire/firestore';

@Component({
    selector: 'app-newsletter',
    standalone: true,
    imports: [CommonModule, FormsModule, ReactiveFormsModule],
    template: `
    <div class="newsletter-section">
      <div class="newsletter-container">
        <div class="newsletter-content">
          <h3>{{ isSuccess ? '¡Gracias por suscribirte!' : '📧 Suscríbete a nuestro boletín' }}</h3>
          <p *ngIf="!isSuccess">Recibe ofertas exclusivas, nuevos productos y tips para tu motocicleta.</p>
          
          <form *ngIf="!isSuccess" [formGroup]="newsletterForm" (ngSubmit)="onSubmit()" class="newsletter-form">
            <div class="form-group">
              <input 
                type="email" 
                formControlName="email"
                placeholder="tu@email.com"
                [class.error]="newsletterForm.get('email')?.invalid && newsletterForm.get('email')?.touched"
              >
              <button type="submit" [disabled]="isSubmitting || newsletterForm.invalid">
                {{ isSubmitting ? '⏳' : '→' }}
              </button>
            </div>
            
            <div class="form-footer">
              <label class="checkbox-label">
                <input type="checkbox" formControlName="acceptPrivacy">
                <span>Acepto la <a href="/privacy" target="_blank">política de privacidad</a></span>
              </label>
            </div>

            <p class="error-message" *ngIf="errorMessage">{{ errorMessage }}</p>
          </form>

          <p *ngIf="isSuccess" class="success-message">
            ✓ Te hemos enviado un correo de confirmación. Revisa tu bandeja de entrada.
          </p>
        </div>
      </div>
    </div>
  `,
    styles: [`
    .newsletter-section {
      background: linear-gradient(135deg, #00ACD8 0%, #0088b3 100%);
      padding: 4rem 2rem;
      margin: 4rem 0;
    }

    .newsletter-container {
      max-width: 600px;
      margin: 0 auto;
    }

    .newsletter-content {
      text-align: center;
      color: white;
    }

    h3 {
      font-size: 2rem;
      margin-bottom: 1rem;
      font-weight: 700;
    }

    p {
      font-size: 1.1rem;
      margin-bottom: 2rem;
      opacity: 0.9;
    }

    .newsletter-form {
      max-width: 500px;
      margin: 0 auto;
    }

    .form-group {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    input[type="email"] {
      flex: 1;
      padding: 1rem 1.5rem;
      border: none;
      border-radius: 50px;
      font-size: 1rem;
      background: rgba(255, 255, 255, 0.95);
      color: #1a1a1a;
    }

    input[type="email"].error {
      border: 2px solid #D02C2F;
    }

    input[type="email"]:focus {
      outline: none;
      background: white;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
    }

    button[type="submit"] {
      padding: 1rem 2rem;
      background: #93D500;
      color: #1a1a1a;
      border: none;
      border-radius: 50px;
      font-size: 1.5rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s;
      min-width: 60px;
    }

    button[type="submit"]:hover:not(:disabled) {
      background: #a8f000;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(147, 213, 0, 0.4);
    }

    button[type="submit"]:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .form-footer {
      margin-top: 1rem;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      cursor: pointer;
    }

    .checkbox-label input[type="checkbox"] {
      cursor: pointer;
    }

    .checkbox-label a {
      color: white;
      text-decoration: underline;
    }

    .error-message {
      color: #FFD700;
      font-size: 0.9rem;
      margin-top: 1rem;
      background: rgba(208, 44, 47, 0.2);
      padding: 0.75rem;
      border-radius: 8px;
    }

    .success-message {
      font-size: 1.1rem;
      background: rgba(147, 213, 0, 0.2);
      padding: 1.5rem;
      border-radius: 12px;
      margin-top: 1rem;
    }

    @media (max-width: 768px) {
      .newsletter-section {
        padding: 3rem 1rem;
      }

      h3 {
        font-size: 1.5rem;
      }

      .form-group {
        flex-direction: column;
      }

      button[type="submit"] {
        width: 100%;
      }
    }
  `]
})
export class NewsletterComponent {
    private firestore = inject(Firestore);
    private fb = inject(FormBuilder);

    newsletterForm: FormGroup;
    isSubmitting = false;
    isSuccess = false;
    errorMessage = '';

    constructor() {
        this.newsletterForm = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            acceptPrivacy: [false, Validators.requiredTrue]
        });
    }

    async onSubmit() {
        if (this.newsletterForm.invalid) {
            this.newsletterForm.markAllAsTouched();
            return;
        }

        this.isSubmitting = true;
        this.errorMessage = '';

        try {
            const email = this.newsletterForm.value.email.toLowerCase().trim();

            // Check if email already exists
            const newsletterCollection = collection(this.firestore, 'newsletter');
            const q = query(newsletterCollection, where('email', '==', email));
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                this.errorMessage = 'Este correo ya está suscrito a nuestro boletín.';
                this.isSubmitting = false;
                return;
            }

            // Add new subscriber
            await addDoc(newsletterCollection, {
                email,
                subscribedAt: Timestamp.now(),
                source: 'website',
                active: true
            });

            // Track with GA4
            if (typeof gtag !== 'undefined') {
                gtag('event', 'newsletter_signup', {
                    method: 'website_form'
                });
            }

            this.isSuccess = true;
            this.newsletterForm.reset();

        } catch (error) {
            console.error('Newsletter signup error:', error);
            this.errorMessage = 'Hubo un error al procesar tu suscripción. Por favor intenta de nuevo.';
        } finally {
            this.isSubmitting = false;
        }
    }
}
