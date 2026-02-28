import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './admin-login.component.html',
  styleUrl: './admin-login.component.css'
})
export class AdminLoginComponent implements OnInit {
  authService = inject(AuthService);
  private fb = inject(FormBuilder);
  
  loginForm!: FormGroup;
  showPassword = false;

  ngOnInit() {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  async loginWithEmail() {
    if (this.loginForm.valid) {
      const { email, password } = this.loginForm.value;
      await this.authService.loginWithEmail(email, password);
    }
  }

  loginWithGoogle() {
    this.authService.loginWithGoogle();
  }
}
