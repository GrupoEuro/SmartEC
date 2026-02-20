import { Component, Input, OnChanges, SimpleChanges, ElementRef, ViewChild, inject } from '@angular/core';
import katex from 'katex';

@Component({
    selector: 'app-katex-formula',
    standalone: true,
    template: `
    <div #formulaContainer class="katex-container"></div>
  `,
    styles: [`
    :host {
      display: block;
    }
    .katex-container {
      font-size: 1.1em;
      overflow-x: auto;
      padding: 0.5rem 0;
    }
  `]
})
export class KatexFormulaComponent implements OnChanges {
    @Input() formula: string = '';
    @ViewChild('formulaContainer', { static: true }) container!: ElementRef;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['formula'] && this.formula) {
            this.render();
        }
    }

    private render() {
        try {
            katex.render(this.formula, this.container.nativeElement, {
                throwOnError: false,
                displayMode: true // Render in display mode (centered, larger)
            });
        } catch (e) {
            console.error('KaTeX rendering error:', e);
            this.container.nativeElement.innerText = this.formula;
        }
    }
}
