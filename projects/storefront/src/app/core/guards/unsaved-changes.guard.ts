import { Injectable, inject } from '@angular/core';
import { CanDeactivate } from '@angular/router';
import { ConfirmDialogService } from '../services/confirm-dialog.service';

export interface CanComponentDeactivate {
    canDeactivate: () => boolean | Promise<boolean>;
}

@Injectable({
    providedIn: 'root'
})
export class UnsavedChangesGuard implements CanDeactivate<CanComponentDeactivate> {
    private confirmDialog = inject(ConfirmDialogService);

    async canDeactivate(component: CanComponentDeactivate): Promise<boolean> {
        if (component.canDeactivate) {
            return await component.canDeactivate();
        }
        return true;
    }
}
