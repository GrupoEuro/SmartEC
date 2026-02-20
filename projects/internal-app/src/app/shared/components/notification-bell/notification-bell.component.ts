import { Component, inject, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { NotificationService } from '../../../core/services/notification.service';
import { AppNotification } from '../../../core/models/notification.model';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="notification-container">
      <!-- Backdrop for Click Outside -->
      <div *ngIf="isOpen" class="backdrop-overlay" (click)="isOpen = false"></div>

      <!-- Bell Icon Button -->
      <button class="bell-btn" (click)="toggleDropdown()" [class.active]="isOpen">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <span *ngIf="unreadCount() > 0" class="badge">{{ unreadCount() > 9 ? '9+' : unreadCount() }}</span>
      </button>

      <!-- Dropdown Menu -->
      <div class="dropdown-menu" *ngIf="isOpen">
        <div class="dropdown-header">
          <h3>Notifications</h3>
          <button class="mark-all-btn" (click)="markAllRead()">Mark all read</button>
        </div>

        <div class="notification-list">
          <div *ngIf="notifications()?.length === 0" class="empty-state">
            <div class="empty-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <p>All caught up!</p>
          </div>

          <div *ngFor="let note of notifications()" 
               class="notification-item" 
               [class.unread]="!note.read"
               (click)="handleNotificationClick(note)">
            <div class="icon-wrapper" [ngClass]="note.type">
                <!-- Info -->
                <svg *ngIf="note.type === 'info' || !note.type" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></svg>
                <!-- Warning -->
                <svg *ngIf="note.type === 'warning'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                <!-- Success -->
                <svg *ngIf="note.type === 'success'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <!-- Error -->
                <svg *ngIf="note.type === 'error'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>
            </div>
            <div class="content">
              <p class="title">{{ note.title }}</p>
              <p class="message">{{ note.message }}</p>
              <span class="time">{{ note.timestamp | date:'shortTime' }}</span>
            </div>
            <div class="indicator" *ngIf="!note.read"></div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .notification-container {
      position: relative;
    }

    .backdrop-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 998; /* Below dropdown but above everything else */
      cursor: default;
    }

    .bell-btn {
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      color: #cbd5e1;
      cursor: pointer;
      position: relative;
      padding: 0.5rem;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 36px;
      width: 36px;
      backdrop-filter: blur(8px);
      overflow: hidden;
    }

    .bell-btn::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 100%);
      opacity: 0;
      transition: opacity 0.3s;
    }

    .bell-btn:hover {
      background: rgba(30, 41, 59, 0.7);
      border-color: rgba(148, 163, 184, 0.3);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .bell-btn:hover::before {
      opacity: 1;
    }

    .bell-btn:active, .bell-btn.active {
      background: rgba(251, 191, 36, 0.1);
      border-color: rgba(251, 191, 36, 0.5);
      color: #fbbf24;
      box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.2), 0 4px 12px rgba(251, 191, 36, 0.1);
      transform: translateY(0);
    }

    .badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #ef4444;
      color: white;
      font-size: 0.65rem;
      font-weight: bold;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
      border: 2px solid #0f172a; /* Match header dark bg */
    }

    .dropdown-menu {
      position: absolute;
      top: calc(100% + 0.75rem);
      right: -8px;
      width: 320px;
      background: rgba(15, 23, 42, 0.95);
      border-radius: 0.75rem;
      box-shadow: 0 20px 40px -4px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.2);
      backdrop-filter: blur(16px);
      z-index: 1000; /* Above backdrop */
      overflow: hidden;
      animation: slideDown 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .dropdown-header {
      padding: 1rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.02);
    }

    .dropdown-header h3 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: #f1f5f9;
    }

    .mark-all-btn {
      background: none;
      border: none;
      color: #fbbf24;
      font-size: 0.75rem;
      cursor: pointer;
      font-weight: 500;
      opacity: 0.8;
      transition: opacity 0.2s;
    }

    .mark-all-btn:hover {
      opacity: 1;
      text-decoration: underline;
    }

    .notification-list {
      max-height: 400px;
      overflow-y: auto;
    }

    .notification-item {
      padding: 1rem;
      display: flex;
      gap: 1rem;
      cursor: pointer;
      transition: background 0.2s;
      position: relative;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .notification-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .notification-item.unread {
      background: rgba(59, 130, 246, 0.1); /* Subtle blue tint for unread */
    }

    .icon-wrapper {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .icon-wrapper.info { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
    .icon-wrapper.warning { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
    .icon-wrapper.success { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
    .icon-wrapper.error { background: rgba(248, 113, 113, 0.15); color: #f87171; }

    .content {
      flex: 1;
    }

    .title {
      font-size: 0.875rem;
      font-weight: 600;
      color: #e2e8f0;
      margin: 0 0 0.25rem 0;
    }

    .message {
      font-size: 0.8125rem;
      color: #94a3b8;
      margin: 0 0 0.5rem 0;
      line-height: 1.4;
    }

    .time {
      font-size: 0.7rem;
      color: #64748b;
    }

    .indicator {
      position: absolute;
      top: 1.25rem;
      right: 1rem;
      width: 8px;
      height: 8px;
      background: #fbbf24;
      border-radius: 50%;
      box-shadow: 0 0 0 2px rgba(15, 23, 42, 1);
    }

    .empty-state {
      padding: 2.5rem 1.5rem;
      text-align: center;
      color: #64748b;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }

    .empty-icon {
      color: #334155;
      padding: 1rem;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `]
})
export class NotificationBellComponent {
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  isOpen = false;

  // Real-time signal of notifications
  notifications: Signal<AppNotification[] | undefined> = toSignal(
    this.notificationService.getUnreadNotifications()
  );

  unreadCount: Signal<number> = toSignal(
    this.notificationService.getUnreadNotifications().pipe(
      // Although list is already unread-only by default query, keeping generic for future
      // Actually standardizing: the query limits to 20. Count matches displayed items.
      // For true total count, we'd need a separate aggregate query.
      // For now, this is "visible unread".
    ) as any,
    { initialValue: 0 }
  ) as any; // Simplified for this implementation step, correcting below

  constructor() {
    // Correcting Signal definition
    const obs$ = this.notificationService.getUnreadNotifications();
    this.notifications = toSignal(obs$);
    this.unreadCount = toSignal(
      obs$.pipe(map((list: AppNotification[]) => list.length)),
      { initialValue: 0 }
    );
  }

  toggleDropdown() {
    this.isOpen = !this.isOpen;
  }

  markAllRead() {
    const ids = this.notifications()?.map(n => n.id!) || [];
    if (ids.length) {
      this.notificationService.markAllAsRead(ids);
    }
  }

  handleNotificationClick(note: AppNotification) {
    if (!note.read && note.id) {
      this.notificationService.markAsRead(note.id);
    }
    if (note.link) {
      this.router.navigateByUrl(note.link);
      this.isOpen = false;
    }
  }

  getIcon(type: string): string {
    switch (type) {
      case 'warning': return 'fa-exclamation-triangle';
      case 'success': return 'fa-check';
      case 'error': return 'fa-times-circle';
      default: return 'fa-info-circle';
    }
  }
}
