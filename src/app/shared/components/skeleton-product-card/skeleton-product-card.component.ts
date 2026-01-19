import { Component } from '@angular/core';

@Component({
    selector: 'app-skeleton-product-card',
    standalone: true,
    template: `
    <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 h-full flex flex-col gap-4 animate-pulse">
        <!-- Image placeholder -->
        <div class="w-full aspect-[4/5] bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
        
        <!-- Content -->
        <div class="space-y-3 flex-1">
            <!-- Title lines -->
            <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
            <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
            
            <!-- Price block -->
            <div class="pt-4 mt-auto">
                <div class="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-2"></div>
                <div class="h-10 bg-slate-200 dark:bg-slate-700 rounded-lg w-full"></div>
            </div>
        </div>
    </div>
  `
})
export class SkeletonProductCardComponent { }
