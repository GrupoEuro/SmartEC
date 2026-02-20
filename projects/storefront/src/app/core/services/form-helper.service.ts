import { Injectable, inject } from '@angular/core';
import { FormGroup, FormArray, AbstractControl } from '@angular/forms';

@Injectable({
    providedIn: 'root'
})
export class FormHelperService {

    /**
     * Mark all fields as touched to show validation errors
     */
    markAllAsTouched(form: FormGroup | FormArray): void {
        Object.keys(form.controls).forEach(key => {
            const control = form.get(key);
            control?.markAsTouched();

            if (control instanceof FormGroup || control instanceof FormArray) {
                this.markAllAsTouched(control);
            }
        });
    }

    /**
     * Get all validation errors from form
     */
    getFormErrors(form: FormGroup): { [key: string]: any } {
        const errors: { [key: string]: any } = {};

        Object.keys(form.controls).forEach(key => {
            const control = form.get(key);
            if (control?.errors) {
                errors[key] = control.errors;
            }
        });

        return errors;
    }

    /**
     * Generate slug from text
     */
    generateSlug(text: string): string {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove accents
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Validate image file
     */
    validateImage(file: File, maxSizeMB = 5): { valid: boolean; error?: string } {
        const maxSize = maxSizeMB * 1024 * 1024;
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

        if (file.size > maxSize) {
            return { valid: false, error: `Image must be less than ${maxSizeMB}MB` };
        }

        if (!allowedTypes.includes(file.type)) {
            return { valid: false, error: 'Only JPG, PNG, and WebP images are allowed' };
        }

        return { valid: true };
    }

    /**
     * Format price for display
     */
    formatPrice(price: number, currency = 'MXN'): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: currency
        }).format(price);
    }

    /**
     * Calculate form completion percentage
     */
    getFormCompletionPercentage(form: FormGroup): number {
        const controls = Object.keys(form.controls);
        const validControls = controls.filter(key => {
            const control = form.get(key);
            return control?.valid || !control?.hasError('required');
        });

        return Math.round((validControls.length / controls.length) * 100);
    }
}
