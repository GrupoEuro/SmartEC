import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-debug-role-widget',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  styles: [`
    .dbg-wrap {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      z-index: 99999;
      background: rgba(15,23,42,.97);
      border: 1px solid rgba(99,102,241,.4);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.6);
      font-family: 'JetBrains Mono', monospace;
      font-size: .75rem;
      min-width: 240px;
      overflow: hidden;
      pointer-events: auto;
    }
    .dbg-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .5rem .75rem;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(99,102,241,.1);
      cursor: default;
    }
    .dbg-title {
      color: #a5b4fb;
      font-size: .65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .dbg-actions { display: flex; gap: .25rem; }
    .dbg-btn {
      all: unset;
      box-sizing: border-box;
      border: 1px solid rgba(255,255,255,.2);
      border-radius: 5px;
      color: #94a3b8;
      cursor: pointer !important;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: .9rem;
      line-height: 1;
      pointer-events: auto !important;
    }
    .dbg-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
    .dbg-btn.cls:hover { background: rgba(239,68,68,.15); color: #f87171; border-color: rgba(239,68,68,.4); }
    .dbg-body {
      padding: .75rem;
      display: flex;
      flex-direction: column;
      gap: .5rem;
    }
    .dbg-row { display: flex; flex-direction: column; gap: .15rem; }
    .dbg-lbl { color: #475569; font-size: .6rem; text-transform: uppercase; letter-spacing: .06em; }
    .dbg-val { color: #94a3b8; font-size: .7rem; word-break: break-all; }
    .dbg-val.email { color: #34d399; }
    .dbg-pill {
      display: inline-block;
      padding: .2rem .6rem;
      background: rgba(99,102,241,.2);
      border: 1px solid rgba(99,102,241,.4);
      border-radius: 5px;
      color: #a5b4fb;
      font-size: .7rem;
      font-weight: 700;
    }
  `],
  template: `
    @if (profile() && !dismissed()) {
      <div class="dbg-wrap">
        <div class="dbg-header">
          <span class="dbg-title">⚙ Auth Context</span>
          <div class="dbg-actions">
            <button type="button" class="dbg-btn" (click)="toggle()" [title]="minimized() ? 'Expandir' : 'Minimizar'">
              {{ minimized() ? '▲' : '▼' }}
            </button>
            <button type="button" class="dbg-btn cls" (click)="close()" title="Cerrar">✕</button>
          </div>
        </div>
        @if (!minimized()) {
          <div class="dbg-body">
            <div class="dbg-row">
              <span class="dbg-lbl">Email</span>
              <span class="dbg-val email">{{ profile()?.email }}</span>
            </div>
            <div class="dbg-row">
              <span class="dbg-lbl">UID</span>
              <span class="dbg-val">{{ profile()?.uid }}</span>
            </div>
            <div class="dbg-row">
              <span class="dbg-lbl">Rol asignado</span>
              <span class="dbg-pill">{{ profile()?.role || 'NONE' }}</span>
            </div>
          </div>
        }
      </div>
    }
  `
})
export class DebugRoleWidgetComponent {
  private authService = inject(AuthService);

  profile   = this.authService.currentProfile;
  minimized = signal(false);
  dismissed = signal(false);

  toggle() { this.minimized.update(v => !v); }
  close()  { this.dismissed.set(true); }
}

