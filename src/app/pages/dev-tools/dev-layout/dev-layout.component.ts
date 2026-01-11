import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
  selector: 'app-dev-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, AppIconComponent],
  styleUrls: ['./dev-layout.component.css'],
  template: `
    <div class="dev-layout">
      <!-- Sidebar -->
      <aside class="dev-sidebar">
        <div class="sidebar-header">
          <div class="logo-box">
            <app-icon name="settings" [size]="20"></app-icon>
          </div>
          <div>
            <h1 class="brand-title">DevTools</h1>
            <div class="brand-subtitle">Portal</div>
            <div class="brand-version">v1.4.0</div>
          </div>
        </div>

        <nav class="sidebar-nav">
          <a routerLink="/dev-tools/icons" 
             routerLinkActive="active"
             class="nav-item">
            <app-icon name="grid" [size]="18"></app-icon>
            Icon Library
          </a>

          <a routerLink="/dev-tools/libraries"
             routerLinkActive="active"
             class="nav-item">
            <app-icon name="layers" [size]="18"></app-icon>
            Stack Explorer
          </a>

          <a routerLink="/dev-tools/stats"
             routerLinkActive="active"
             class="nav-item">
            <app-icon name="activity" [size]="18"></app-icon>
            Project Vitality
          </a>

          <a routerLink="/dev-tools/backlog"
             routerLinkActive="active"
             class="nav-item">
            <app-icon name="list" [size]="18"></app-icon>
            Backlog Manager
          </a>
          
          <a routerLink="/dev-tools/data" 
             routerLinkActive="active"
             class="nav-item">
            <app-icon name="database" [size]="18"></app-icon>
            Data Seeder
          </a>





          <a routerLink="/dev-tools/database" 
             routerLinkActive="active"
             class="nav-item">
            <app-icon name="activity" [size]="18"></app-icon>
            Database Outlook
          </a>

          <a routerLink="/dev-tools/firestore" 
             routerLinkActive="active"
             class="nav-item">
            <app-icon name="trending-up" [size]="18"></app-icon>
            Firestore Usage
          </a>

          <a routerLink="/dev-tools/logs" 
             routerLinkActive="active"
             class="nav-item">
            <app-icon name="file-text" [size]="18"></app-icon>
            Log Explorer
          </a>

          <div class="nav-section">
            <div class="section-title">
              System
            </div>
            <a routerLink="/dev-tools/state" 
               routerLinkActive="active"
               class="nav-item">
              <app-icon name="camera" [size]="18"></app-icon>
              State Inspector
            </a>

            <a routerLink="/dev-tools/routes" 
               routerLinkActive="active"
               class="nav-item">
              <app-icon name="map" [size]="18"></app-icon>
              Route Map
            </a>

            <a routerLink="/dev-tools/permissions" 
               routerLinkActive="active"
               class="nav-item">
              <app-icon name="shield" [size]="18"></app-icon>
              Permissions Map
            </a>

            <a routerLink="/dev-tools/i18n" 
               routerLinkActive="active"
               class="nav-item">
              <app-icon name="globe" [size]="18"></app-icon>
              Localization
            </a>

            <a routerLink="/dev-tools/config" 
               routerLinkActive="active"
               class="nav-item">
              <app-icon name="settings" [size]="18"></app-icon>
              Configuration
            </a>
            <a routerLink="/dev-tools/theme" 
               routerLinkActive="active"
               class="nav-item">
              <app-icon name="palette" [size]="18"></app-icon>
              Theme Studio
            </a>
          </div>
        </nav>

        <div class="sidebar-footer">
           <a routerLink="/command-center" class="back-link">
             <app-icon name="arrow-left" [size]="14"></app-icon>
             Back to Command Center
           </a>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="dev-content">
        <router-outlet></router-outlet>
      </main>
    </div>
  `
})
export class DevLayoutComponent { }
