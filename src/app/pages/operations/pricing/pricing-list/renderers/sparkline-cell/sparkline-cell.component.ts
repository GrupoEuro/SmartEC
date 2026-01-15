import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

@Component({
  selector: 'app-sparkline-cell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sparkline-container" [title]="tooltip">
      <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
        <!-- Trend Line -->
        <path [attr.d]="pathData" 
              fill="none" 
              [attr.stroke]="color" 
              stroke-width="2"
              stroke-linecap="round" 
              stroke-linejoin="round"/>
        
        <!-- Fill Area (Optional, using low opacity) -->
        <path [attr.d]="fillPathData" 
              [attr.fill]="color" 
              fill-opacity="0.1" 
              stroke="none"/>
      </svg>
    </div>
  `,
  styles: [`
    .sparkline-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      padding: 4px 0;
    }
  `]
})
export class SparklineCellComponent implements ICellRendererAngularComp {
  pathData = '';
  fillPathData = '';
  color = '#cbd5e1'; // Default slate-300
  tooltip = '';

  agInit(params: ICellRendererParams): void {
    this.updateSparkline(params.value);
  }

  refresh(params: ICellRendererParams): boolean {
    this.updateSparkline(params.value);
    return true;
  }

  private updateSparkline(data: number[] | undefined) {
    if (!data || data.length === 0) return;

    // Normalizing data to 100x30 viewbox
    const max = Math.max(...data, 1); // Avoid div by zero
    const min = Math.min(...data);
    const range = max - min || 1;

    const width = 100;
    const height = 30;
    const step = width / (data.length - 1);

    // Generate Points
    const points = data.map((val, i) => {
      const x = i * step;
      // Invert Y because SVG 0 is top
      const y = height - ((val - min) / range) * height;
      return `${x},${y}`;
    });

    // Create Path
    this.pathData = `M ${points.join(' L ')}`;

    // Create Fill Path (Close the loop at bottom)
    this.fillPathData = `${this.pathData} L ${width},${height} L 0,${height} Z`;

    // Determine Color (Trend of last 5 vs first 5)
    // Simple logic: if last 3 avg > first 3 avg => Green, else Red? 
    // Or based on velocity magnitude? Let's do simple Green for active
    const total = data.reduce((a, b) => a + b, 0);
    if (total > 20) this.color = '#22c55e'; // Green-500
    else if (total > 5) this.color = '#3b82f6'; // Blue-500
    else this.color = '#94a3b8'; // Slate-400

    this.tooltip = `Last 30 Days: ${total} units`;
  }
}
