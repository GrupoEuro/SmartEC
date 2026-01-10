import { Directive, Input, TemplateRef, ViewContainerRef, inject, OnInit, OnDestroy } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { Subscription } from 'rxjs';
import { UserRole } from '../models/user.model';

@Directive({
    selector: '[appHasRole]',
    standalone: true
})
export class HasRoleDirective implements OnInit, OnDestroy {
    private authService = inject(AuthService);
    private templateRef = inject(TemplateRef<any>);
    private viewContainer = inject(ViewContainerRef);
    private sub?: Subscription;

    @Input() appHasRole: UserRole[] = [];

    ngOnInit() {
        this.sub = this.authService.userProfile$.subscribe(user => {
            this.viewContainer.clear();

            if (user && this.appHasRole.includes(user.role)) {
                this.viewContainer.createEmbeddedView(this.templateRef);
            }
        });
    }

    ngOnDestroy() {
        this.sub?.unsubscribe();
    }
}
