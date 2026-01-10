import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ConfirmOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'info' | 'warning' | 'danger';
}

interface ConfirmState {
    isOpen: boolean;
    options: ConfirmOptions | null;
    resolve: ((value: boolean) => void) | null;
}

@Injectable({
    providedIn: 'root'
})
export class ConfirmDialogService {
    private state = new BehaviorSubject<ConfirmState>({
        isOpen: false,
        options: null,
        resolve: null
    });

    state$ = this.state.asObservable();

    /**
     * Show confirmation dialog
     */
    confirm(options: ConfirmOptions): Promise<boolean> {
        return new Promise((resolve) => {
            this.state.next({
                isOpen: true,
                options: {
                    confirmText: 'Confirm',
                    cancelText: 'Cancel',
                    type: 'info',
                    ...options
                },
                resolve
            });
        });
    }

    /**
     * Confirm delete action
     */
    confirmDelete(itemName: string, itemType: string = 'item'): Promise<boolean> {
        return this.confirm({
            title: `Delete ${itemType}?`,
            message: `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            type: 'danger'
        });
    }

    /**
     * Confirm with warning
     */
    confirmWarning(title: string, message: string): Promise<boolean> {
        return this.confirm({
            title,
            message,
            confirmText: 'Continue',
            cancelText: 'Cancel',
            type: 'warning'
        });
    }

    /**
     * Handle user response
     */
    handleResponse(confirmed: boolean): void {
        const currentState = this.state.value;
        if (currentState.resolve) {
            currentState.resolve(confirmed);
        }
        this.close();
    }

    /**
     * Close dialog
     */
    close(): void {
        this.state.next({
            isOpen: false,
            options: null,
            resolve: null
        });
    }
}
