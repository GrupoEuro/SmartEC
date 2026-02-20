import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { ReceivingService } from '../../../../core/services/receiving.service';
import { PutawayTask } from '../../../../core/models/receiving.model';

@Component({
    selector: 'app-putaway-tasks',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, AppIconComponent],
    templateUrl: './putaway-tasks.component.html',
    styleUrls: ['./putaway-tasks.component.css']
})
export class PutawayTasksComponent implements OnInit {
    private receivingService = inject(ReceivingService);
    private router = inject(Router);

    // State
    pendingTasks = signal<PutawayTask[]>([]);
    completedTasks = signal<PutawayTask[]>([]);
    selectedTask = signal<PutawayTask | null>(null);
    processing = signal(false);
    selectedWarehouse = signal('MAIN');

    // Scan input
    scannedProduct = signal('');
    scannedBin = signal('');

    ngOnInit() {
        this.loadTasks();
    }

    loadTasks() {
        // Load pending tasks
        this.receivingService.getPutawayTasks(this.selectedWarehouse(), 'pending').subscribe(tasks => {
            this.pendingTasks.set(tasks);
        });

        // Load recently completed tasks
        this.receivingService.getPutawayTasks(this.selectedWarehouse(), 'completed').subscribe(tasks => {
            const recent = tasks.slice(0, 10); // Last 10
            this.completedTasks.set(recent);
        });
    }

    // Select task to work on
    selectTask(task: PutawayTask | null) {
        this.selectedTask.set(task);
        this.scannedProduct.set('');
        this.scannedBin.set('');
    }

    // Complete putaway
    async completePutaway() {
        const task = this.selectedTask();
        if (!task) return;

        // Validate bin location (simplified - use scanned or suggested)
        const binLocation = this.scannedBin() || task.suggestedLocation;

        this.processing.set(true);
        try {
            await this.receivingService.completePutaway(task.id!, binLocation, 'current-user');
            this.selectedTask.set(null);
            this.scannedProduct.set('');
            this.scannedBin.set('');
        } catch (error) {
            console.error('Error completing putaway:', error);
            alert('Error completing putaway. Please try again.');
        } finally {
            this.processing.set(false);
        }
    }

    // Navigate back to receiving dashboard
    backToDashboard() {
        this.router.navigate(['/operations/receiving']);
    }

    // Get priority badge color
    getPriorityColor(priority: string): string {
        switch (priority) {
            case 'high': return 'bg-red-500/20 text-red-400 border-red-500/30';
            case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            case 'low': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
        }
    }
}
