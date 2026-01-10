import { Component, ElementRef, Input, OnChanges, AfterViewInit, ViewChild, inject, signal, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import mermaid from 'mermaid';

@Component({
  selector: 'app-visual-workflow',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="workflow-container">
      <!-- Loading State -->
      <div *ngIf="isRendering()" class="loading-overlay">
        <div class="spinner"></div>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage()" class="error-overlay">
        <div class="error-content">
            <svg xmlns="http://www.w3.org/2000/svg" class="error-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p>{{ errorMessage() }}</p>
        </div>
      </div>

      <!-- Controls Overlay: Hidden by default key user request -->
      <div class="controls-overlay" style="display: none;">
        <button (click)="resetZoom()" class="control-btn" title="Reset View">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <!-- Mermaid Diagram -->
      <div #mermaidDiv class="mermaid-content"></div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    .workflow-container {
      background-color: rgba(30, 41, 59, 0.5); /* Slate 800/50 */
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1rem;
      position: relative;
      overflow: hidden;
      min-height: 300px;
    }

    .mermaid-content {
      width: 100%;
      height: 100%;
      min-height: 300px;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .loading-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      z-index: 10;
    }

    .error-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(15, 23, 42, 0.9);
        z-index: 30;
    }

    .error-content {
        text-align: center;
        color: #f87171;
    }

    .error-icon {
        width: 48px;
        height: 48px;
        margin: 0 auto 1rem auto;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 4px solid rgba(59, 130, 246, 0.3);
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .controls-overlay {
      position: absolute;
      top: 1rem;
      right: 1rem;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 20;
    }

    .workflow-container:hover .controls-overlay {
      opacity: 1;
    }

    .control-btn {
      padding: 0.5rem;
      background-color: #334155;
      color: #cbd5e1;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s, color 0.2s;
    }

    .control-btn:hover {
      background-color: #475569;
      color: #fff;
    }
    
    /* Mermaid Styling Overrides */
    ::ng-deep .node rect,
    ::ng-deep .node circle,
    ::ng-deep .node polygon {
      stroke-width: 2px;
    }
    
    ::ng-deep .edgePath .path {
      stroke: #64748b !important;
      stroke-width: 2px !important;
    }

    ::ng-deep .arrowheadPath {
      fill: #64748b !important;
    }
  `]
})
export class VisualWorkflowComponent implements OnChanges, AfterViewInit {
  @Input() definition: string = '';
  @Input() config: any = {};
  @ViewChild('mermaidDiv') mermaidDiv!: ElementRef;

  private platformId = inject(PLATFORM_ID);
  isRendering = signal(false);
  errorMessage = signal<string | null>(null);

  constructor() {
    // Initialize Mermaid Configuration ONLY in Browser
    if (isPlatformBrowser(this.platformId)) {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
          fontFamily: 'Inter, system-ui, sans-serif',
          ...this.config
        });
      } catch (e) {
        console.error('Mermaid initialization error:', e);
      }
    }
  }

  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId) && this.definition) {
      this.renderDiagram();
    }
  }

  ngOnChanges() {
    if (isPlatformBrowser(this.platformId) && this.definition && this.mermaidDiv) {
      this.renderDiagram();
    }
  }

  async renderDiagram() {
    if (!isPlatformBrowser(this.platformId) || !this.mermaidDiv) return;

    this.isRendering.set(true);
    this.errorMessage.set(null);
    const element = this.mermaidDiv.nativeElement;

    try {
      const id = `mermaid-${Math.floor(Math.random() * 10000)}`;
      // console.debug('Attempting to render mermaid graph:', id);

      element.innerHTML = '';

      // Check if definition is valid
      if (!this.definition || this.definition.trim().length === 0) {
        throw new Error('Graph definition is empty');
      }

      const { svg } = await mermaid.render(id, this.definition);
      element.innerHTML = svg;
      // console.debug('Mermaid render success');

    } catch (error: any) {
      console.error('Mermaid rendering failed:', error);
      this.errorMessage.set(error?.message || 'Diagram rendering failed');
      element.innerHTML = '';
    } finally {
      this.isRendering.set(false);
    }
  }

  resetZoom() {
    this.renderDiagram();
  }
}
