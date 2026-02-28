import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-debug-role-widget',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (profile) {
      <div class="fixed bottom-4 right-4 z-[9999] bg-slate-900/95 backdrop-blur-md border border-slate-700/50 p-4 rounded-xl shadow-2xl min-w-[250px] animate-in slide-in-from-bottom-4">
        <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-700/50">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider">Debug: Auth Context</h3>
          </div>
          <button (click)="toggleMinimize()" class="text-slate-500 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path *ngIf="!minimized" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              <path *ngIf="minimized" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>

        @if (!minimized) {
          <div class="space-y-2 text-sm font-mono">
            <div class="flex flex-col">
              <span class="text-slate-500 text-xs uppercase">Email</span>
              <span class="text-emerald-400 font-medium truncate" title="{{ profile?.email }}">{{ profile?.email }}</span>
            </div>
            
            <div class="flex flex-col">
              <span class="text-slate-500 text-xs uppercase">UID</span>
              <span class="text-slate-300 text-xs truncate" title="{{ profile?.uid }}">{{ profile?.uid }}</span>
            </div>

            <div class="flex flex-col pt-1">
              <span class="text-slate-500 text-xs uppercase mb-1">Assigned Role</span>
              <div class="inline-flex items-center gap-1">
                <span class="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded text-xs font-bold">
                  {{ profile?.role || 'NONE' }}
                </span>
              </div>
            </div>

            <div class="mt-3 pt-3 border-t border-slate-700/50">
              <p class="text-[10px] text-slate-500 italic">
                Permissions dictate access to /operations, /command-center, and /admin segments based on route guards.
              </p>
            </div>
          </div>
        }
      </div>
    }
  `
})
export class DebugRoleWidgetComponent {
  public authService: AuthService = inject(AuthService);
  minimized = false;

  get profile(): any {
    return this.authService.currentProfile();
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
  }
}
