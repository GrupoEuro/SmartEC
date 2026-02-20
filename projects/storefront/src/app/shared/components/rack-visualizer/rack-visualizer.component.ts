import { Component, inject, Input, Output, EventEmitter, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppIconComponent } from '../app-icon/app-icon.component'; // Adjusted path just in case, but ../../app-icon seems right if in shared/components/rack-visualizer. Wait. shared/components/rack-visualizer/rack-visualizer.ts -> ../../app-icon/app-icon.ts is correct.
import { WarehouseService } from '../../../core/services/warehouse.service';
import { StorageLocation, StorageStructure } from '../../../core/models/warehouse.model';

@Component({
    selector: 'app-rack-visualizer',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in" (click)="close.emit()">
      
      <div class="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-6 w-[90vw] max-w-5xl h-[80vh] flex flex-col" (click)="$event.stopPropagation()">
        
        <!-- Header -->
        <div class="flex justify-between items-start mb-6">
           <div>
              <h2 class="text-2xl font-bold text-white flex items-center gap-3">
                 <app-icon name="server" class="text-purple-400" [size]="28"></app-icon>
                 {{ structure?.name || 'Rack Detail' }}
              </h2>
              <p class="text-zinc-400 mt-1">Code: {{ structure?.code }} • Zone: {{ structure?.zoneId }}</p>
           </div>
           <button (click)="close.emit()" class="text-zinc-500 hover:text-white transition-colors">
              <app-icon name="x" [size]="24"></app-icon>
           </button>
        </div>

        <!-- Visual Grid -->
        <div class="flex-1 overflow-auto bg-zinc-950 rounded-lg p-8 relative">
           
           <div *ngIf="isLoading()" class="absolute inset-0 flex items-center justify-center bg-zinc-900/50 z-10">
               <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
           </div>

           <div class="grid gap-4 mx-auto" 
                [style.gridTemplateColumns]="'repeat(' + (structure?.bays || 1) + ', minmax(120px, 1fr))'"
                [style.maxWidth]="(structure?.bays || 1) * 200 + 'px'">
                
                <ng-container *ngFor="let level of levelsReverse">
                    <div *ngFor="let bay of bays" class="aspect-square bg-zinc-900 border border-zinc-800 rounded-md relative group hover:border-purple-500 transition-all cursor-pointer overflow-hidden">
                        
                        <div class="absolute top-2 left-2 text-xs font-mono text-zinc-600 group-hover:text-zinc-400">
                           {{ bay }}-{{ level }}
                        </div>

                        <ng-container *ngIf="getLocation(bay, level) as loc">
                             <div class="w-full h-full p-4 flex flex-col justify-end">
                                 <div *ngIf="loc.status !== 'empty'" class="w-full bg-zinc-800 rounded-full h-1.5 mb-2 overflow-hidden">
                                     <div class="h-full rounded-full" 
                                          [style.width.%]="loc.currentUtilization || 0"
                                          [class.bg-emerald-500]="loc.status === 'partial'"
                                          [class.bg-amber-500]="loc.status === 'full'"
                                          [class.bg-red-500]="loc.status === 'blocked'"></div>
                                 </div>
                                 
                                 <div *ngIf="loc.productId" class="text-sm font-bold text-white truncate">
                                     {{ loc.productName || 'Product' }}
                                 </div>
                                 <div *ngIf="loc.productId" class="text-xs text-zinc-400">
                                     Qty: {{ loc.quantity }}
                                 </div>
                                 
                                 <div *ngIf="loc.status === 'blocked'" class="absolute inset-0 bg-red-900/20 flex items-center justify-center">
                                    <app-icon name="lock" class="text-red-500" [size]="24"></app-icon>
                                 </div>
                             </div>
                        </ng-container>

                        <div *ngIf="!getLocation(bay, level)" class="flex items-center justify-center h-full text-zinc-700 text-xs italic">
                            Unmapped
                        </div>

                    </div>
                </ng-container>

           </div>
        </div>

        <!-- Footer / Legend -->
        <div class="mt-6 flex gap-6 text-sm text-zinc-400">
            <div class="flex items-center gap-2">
                <div class="w-3 h-3 rounded-full bg-emerald-500"></div> Partial
            </div>
            <div class="flex items-center gap-2">
                <div class="w-3 h-3 rounded-full bg-amber-500"></div> Full
            </div>
             <div class="flex items-center gap-2">
                <div class="w-3 h-3 rounded-full bg-red-500"></div> Blocked
            </div>
             <div class="flex items-center gap-2">
                <div class="w-3 h-3 border border-zinc-600"></div> Empty
            </div>
        </div>

      </div>
    </div>
  `,
    styles: [`
    .animate-fade-in { animation: fadeIn 0.2s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  `]
})
export class RackVisualizerComponent implements OnInit {
    @Input() structureId!: string | null;
    @Output() close = new EventEmitter<void>();

    private warehouseService = inject(WarehouseService);

    structure: StorageStructure | undefined;
    locations = signal<StorageLocation[]>([]);
    isLoading = signal(true);

    levelsReverse: number[] = [];
    bays: number[] = [];

    async ngOnInit() {
        if (this.structureId) {
            this.loadData();
        }
    }

    async loadData() {
        this.isLoading.set(true);
        try {
            // Fetch Locations (Bins) - Returns Promise
            const locs = await this.warehouseService.getLocations(this.structureId!);
            this.locations.set(locs);

            // Fetch Structures - Returns Observable
            this.warehouseService.getStructures('any').subscribe(all => {
                this.structure = all.find(s => s.id === this.structureId);
                if (this.structure) {
                    this.levelsReverse = Array.from({ length: this.structure.levels }, (_, i) => this.structure!.levels - i);
                    this.bays = Array.from({ length: this.structure.bays }, (_, i) => i + 1);
                }
                this.isLoading.set(false);
            });

        } catch (e) {
            console.error(e);
            this.isLoading.set(false);
        }
    }

    getLocation(bay: number, level: number) {
        return this.locations().find(l => l.bay === bay && l.level === level);
    }
} 
