import { Component, Input, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AppIconComponent } from '../../app-icon/app-icon.component';
import { NavItem } from '../../../../core/config/admin-navigation.config';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-sidebar-item',
    standalone: true,
    imports: [CommonModule, RouterLink, RouterLinkActive, AppIconComponent, TranslateModule],
    template: `
    <!-- Item Header / Link -->
    <div class="nav-item-container" 
         [class.collapsed]="isCollapsed"
         [class.active]="isActive()"
         [style.padding-left.px]="!isCollapsed ? (depth * 16 + 12) : 12">

      <!-- If it's a link -->
      <a *ngIf="item.route && !hasChildren" 
         [routerLink]="item.route" 
         routerLinkActive="active"
         class="nav-link"
         [title]="isCollapsed ? (item.title | translate) : ''">
         
        <span class="icon-wrapper">
            <app-icon [name]="item.icon" [size]="20"></app-icon>
        </span>
        
        <span class="label" *ngIf="!isCollapsed">
            {{ item.title | translate }}
            <span *ngIf="item.badge" class="badge" [class]="item.badge.color || 'bg-blue-500'">
                {{ item.badge.text }}
            </span>
        </span>
      </a>

      <!-- If it's a section/parent -->
      <button *ngIf="hasChildren" 
              class="nav-link parent-btn" 
              (click)="toggle()"
              [class.open]="isOpen()"
              [title]="isCollapsed ? (item.title | translate) : ''">
              
        <span class="icon-wrapper">
            <app-icon [name]="item.icon" [size]="20"></app-icon>
        </span>

        <span class="label" *ngIf="!isCollapsed">
            {{ item.title | translate }}
        </span>

        <span class="chevron" *ngIf="!isCollapsed">
            <app-icon name="chevron-down" [size]="16" class="chevron-icon" [class.rotated]="isOpen()"></app-icon>
        </span>
      </button>
    </div>

    <!-- Recursive Children -->
    <div *ngIf="hasChildren && !isCollapsed" 
         class="children-container"
         [@slideInOut]="isOpen() ? 'open' : 'closed'">
        
        <app-sidebar-item *ngFor="let child of item.children"
                          [item]="child"
                          [depth]="depth + 1"
                          [isCollapsed]="isCollapsed">
        </app-sidebar-item>
    </div>
  `,
    styles: [`
    :host {
        display: block;
        width: 100%;
    }

    .nav-item-container {
        position: relative;
        margin: 2px 0;
    }

    .nav-link {
        display: flex;
        align-items: center;
        width: 100%;
        padding: 10px 12px;
        color: var(--text-secondary);
        text-decoration: none;
        border-radius: 12px; /* Popped pill shape */
        border: 1px solid transparent;
        background: transparent;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
    }

    .nav-link:hover {
        background-color: rgba(255, 255, 255, 0.03);
        color: var(--text-primary);
        border-color: rgba(255, 255, 255, 0.05);
        transform: translateX(4px);
    }

    /* Active State (Crypto Pill) */
    .nav-link.active {
        background: var(--accent-gradient);
        color: #ffffff;
        font-weight: 600;
        box-shadow: var(--glow-primary);
        border: none;
    }

    .icon-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        min-width: 24px;
        margin-right: 12px;
        transition: color 0.2s;
        opacity: 0.8;
    }

    .nav-link.active .icon-wrapper {
        color: #ffffff;
        opacity: 1;
    }

    .label {
        flex: 1;
        display: flex;
        align-items: center;
        opacity: 1;
        transition: opacity 0.2s;
    }

    /* Badge */
    .badge {
        font-size: 0.7rem;
        padding: 2px 6px;
        border-radius: 12px;
        color: white;
        margin-left: auto;
        font-weight: 700;
        letter-spacing: 0.5px;
    }

    /* Chevron */
    .chevron {
        margin-left: 8px;
        display: flex;
        align-items: center;
    }

    .chevron-icon {
        transition: transform 0.3s ease;
    }

    .chevron-icon.rotated {
        transform: rotate(180deg);
    }

    /* Collapsed Mode Overrides */
    .nav-item-container.collapsed .nav-link {
        padding: 12px;
        justify-content: center;
    }

    .nav-item-container.collapsed .icon-wrapper {
        margin-right: 0;
    }

    /* Animation Wrapper */
    .children-container {
        overflow: hidden;
    }

    /* Hover "Glow" for collapsed Tooltip trick handled by parent usually, 
       but here we can rely on Host title or standard tooltips */
  `],
    animations: [
        trigger('slideInOut', [
            state('open', style({
                height: '*',
                opacity: 1
            })),
            state('closed', style({
                height: '0px',
                opacity: 0
            })),
            transition('open <=> closed', [
                animate('250ms cubic-bezier(0.4, 0, 0.2, 1)')
            ])
        ])
    ]
})
export class SidebarItemComponent {
    @Input() item!: NavItem;
    @Input() depth = 0;
    @Input() isCollapsed = false;

    isOpen = signal(false);

    router = inject(Router);

    get hasChildren(): boolean {
        return !!this.item.children && this.item.children.length > 0;
    }

    isActive(): boolean {
        if (this.item.route) {
            return this.router.isActive(this.item.route, {
                paths: 'subset',
                queryParams: 'subset',
                fragment: 'ignored',
                matrixParams: 'ignored'
            });
        }
        return false;
    }

    toggle() {
        if (this.isCollapsed) return; // Don't expand in collapsed mode
        this.isOpen.update(v => !v);
    }
}
