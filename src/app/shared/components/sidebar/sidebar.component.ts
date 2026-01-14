import { Component, Input, Output, EventEmitter, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NavItem } from '../../../core/config/admin-navigation.config';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { SidebarItemComponent } from './sidebar-item/sidebar-item.component';
import { AuthService } from '../../../core/services/auth.service';

@Component({
    selector: 'app-sidebar',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        TranslateModule,
        AppIconComponent,
        SidebarItemComponent
    ],
    template: `
    <nav class="sidebar-container" [class.collapsed]="isCollapsed()">
      
      <!-- 1. Header & Logo -->
      <div class="sidebar-header">
        <div class="logo-area" *ngIf="!isCollapsed()">
            <h1 class="logo-text">EURO<span class="logo-accent">LLANTAS</span></h1>
        </div>
        <div class="logo-icon" *ngIf="isCollapsed()">
            <h1 class="logo-icon-text">E</h1>
        </div>
        
        <button class="collapse-btn" (click)="toggleCollapse()">
            <app-icon [name]="isCollapsed() ? 'chevron-right' : 'chevron-down'" 
                      [size]="20" 
                      class="toggle-icon"
                      [class.rotated]="isCollapsed()">
            </app-icon>
        </button>
      </div>

      <!-- 2. Search (Quick Filter) -->
      <div class="search-box" *ngIf="!isCollapsed()">
          <span class="search-icon">
              <app-icon name="search" [size]="16"></app-icon>
          </span>
          <input type="text" 
                 [(ngModel)]="searchQuery" 
                 placeholder="Search modules..." 
                 class="search-input">
      </div>

      <!-- 3. Navigation Items (Scrollable) -->
      <div class="nav-scroll-area">
          <ng-container *ngFor="let item of filteredItems()">
              <app-sidebar-item 
                  [item]="item" 
                  [isCollapsed]="isCollapsed()">
              </app-sidebar-item>
          </ng-container>

          <!-- Empty State -->
          <div *ngIf="filteredItems().length === 0" class="empty-state">
              <p>No modules found</p>
          </div>
      </div>

      <!-- 4. User Footer -->
      <div class="sidebar-footer">
        <div class="user-profile" *ngIf="profile() as user">
            <div class="avatar">
                <img [src]="user.photoURL || 'assets/images/default-avatar.png'" alt="User">
            </div>
            <div class="user-info" *ngIf="!isCollapsed()">
                <span class="user-name">{{ user.displayName || 'Admin' }}</span>
                <span class="user-role">{{ user.role }}</span>
            </div>
            <button class="logout-btn" (click)="logout()" title="Logout">
                <app-icon name="log-out" [size]="18"></app-icon>
            </button>
        </div>
      </div>
    </nav>
  `,
    styles: [`
    :host {
        display: block;
        height: 100vh;
        background: #111827; /* gray-900 */
        border-right: 1px solid #1f2937; /* gray-800 */
        transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 50;
    }

    .sidebar-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 260px;
        transition: width 0.3s ease;
    }

    .sidebar-container.collapsed {
        width: 72px;
    }

    /* Header */
    .sidebar-header {
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        border-bottom: 1px solid #1f2937;
        background: rgba(17, 24, 39, 0.95); /* matching bg */
    }

    .logo-area {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .logo-text { color: white; font-weight: 800; font-size: 1.25rem; letter-spacing: -0.5px; margin: 0; }
    .logo-accent { color: #facc15; }
    .logo-icon-text { color: #facc15; font-weight: 800; font-size: 1.5rem; margin: 0; }

    .collapse-btn {
        background: transparent;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        padding: 8px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
    }

    .collapse-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
    }

    .toggle-icon.rotated {
        transform: rotate(-90deg); /* Adjust based on icon choice */
    }

    /* Search */
    .search-box {
        margin: 16px;
        position: relative;
        background: #1f2937;
        border-radius: 8px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid transparent;
        transition: border-color 0.2s;
    }

    .search-box:focus-within {
        border-color: #ffd700;
    }

    .search-icon { color: #6b7280; display: flex; }

    .search-input {
        background: transparent;
        border: none;
        color: white;
        width: 100%;
        outline: none;
        font-size: 0.9rem;
    }

    .search-input::placeholder { color: #4b5563; }

    /* Scroll Area */
    .nav-scroll-area {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        scrollbar-width: thin;
        scrollbar-color: #374151 transparent;
    }

    .nav-scroll-area::-webkit-scrollbar {
        width: 4px;
    }
    
    .nav-scroll-area::-webkit-scrollbar-thumb {
        background-color: #374151;
        border-radius: 4px;
    }

    /* Footer */
    .sidebar-footer {
        padding: 16px;
        border-top: 1px solid #1f2937;
        background: #0f1523;
    }

    .user-profile {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .avatar img {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid #374151;
    }

    .user-info {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .user-name {
        color: white;
        font-size: 0.9rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .user-role {
        color: #9ca3af;
        font-size: 0.75rem;
    }

    .logout-btn {
        background: transparent;
        border: none;
        color: #ef4444; /* red-500 */
        cursor: pointer;
        padding: 8px;
        border-radius: 6px;
        transition: background 0.2s;
        display: flex;
    }

    .logout-btn:hover {
        background: rgba(239, 68, 68, 0.1);
    }
    
    .empty-state {
        text-align: center;
        color: #6b7280;
        padding: 20px;
        font-size: 0.9rem;
    }
  `]
})
export class SidebarComponent {
    @Input() items: NavItem[] = [];
    @Output() collapseChange = new EventEmitter<boolean>();
    @Output() onLogout = new EventEmitter<void>();

    isCollapsed = signal(false);
    searchQuery = signal('');

    authService = inject(AuthService);
    profile = this.authService.currentProfile;

    filteredItems = computed(() => {
        const query = this.searchQuery().toLowerCase();
        if (!query) return this.items;

        // Simple filter: Show items that have title match
        // Ideally we would do deep filtering but for now:
        return this.items.filter(item =>
            item.title.toLowerCase().includes(query) ||
            (item.children && item.children.some(c => c.title.toLowerCase().includes(query)))
        );
    });

    toggleCollapse() {
        this.isCollapsed.update(v => !v);
        this.collapseChange.emit(this.isCollapsed());
    }

    logout() {
        this.onLogout.emit();
    }
}
