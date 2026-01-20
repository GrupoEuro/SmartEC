import { Component, OnInit, OnDestroy, signal, effect, inject } from '@angular/core';
// Trigger rebuild
import { CommonModule, NgClass, NgIf } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TranslateModule } from '@ngx-translate/core';
import { trigger, state, style, transition, animate } from '@angular/animations';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule],
    animations: [
        trigger('fadeSlide', [
            transition(':enter', [
                style({ opacity: 0, transform: 'translateY(20px)' }),
                animate('400ms cubic-bezier(0.25, 0.8, 0.25, 1)', style({ opacity: 1, transform: 'translateY(0)' }))
            ])
        ])
    ],
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.css']
})
export class LoginComponent {
    private auth = inject(AuthService);
    private fb = inject(FormBuilder);
    private router = inject(Router);

    isRegister = signal(false);
    isLoading = signal(false);

    loginForm: FormGroup;
    registerForm: FormGroup;

    constructor() {
        // If already logged in, redirect
        if (this.auth.currentUser()) {
            this.router.navigate(['/account']);
        }

        this.loginForm = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required, Validators.minLength(6)]]
        });

        this.registerForm = this.fb.group({
            displayName: ['', [Validators.required, Validators.minLength(2)]],
            email: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required, Validators.minLength(6)]],
            confirmPassword: ['', [Validators.required]]
        });
    }

    toggleMode() {
        this.isRegister.set(!this.isRegister());
    }

    async onLogin() {
        if (this.loginForm.invalid) return;

        this.isLoading.set(true);
        const { email, password } = this.loginForm.value;

        await this.auth.loginWithEmail(email, password);
        this.isLoading.set(false);
    }

    async onRegister() {
        if (this.registerForm.invalid) return;

        const { displayName, email, password, confirmPassword } = this.registerForm.value;

        if (password !== confirmPassword) {
            // Manual error setting could be done here, or cleaner Validator
            alert('Passwords do not match'); // Simple fallback, ideally Toast
            return;
        }

        this.isLoading.set(true);
        await this.auth.registerWithEmail(email, password, displayName);
        this.isLoading.set(false);
    }

    async onGoogleLogin() {
        this.isLoading.set(true);
        await this.auth.loginWithGoogle();
        this.isLoading.set(false);
    }
}
