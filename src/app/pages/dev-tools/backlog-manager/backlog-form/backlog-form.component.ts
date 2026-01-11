import { Component, EventEmitter, Input, Output, inject, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { BacklogService } from '../../../../core/services/backlog.service';
import { BacklogItem } from '../../../../core/models/backlog.model';

@Component({
    selector: 'app-backlog-form',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule, AppIconComponent],
    templateUrl: './backlog-form.component.html',
    styleUrls: ['./backlog-form.component.css']
})
export class BacklogFormComponent implements OnChanges {
    private fb = inject(FormBuilder);
    private backlogService = inject(BacklogService);

    @Input() item: BacklogItem | null = null;
    @Output() close = new EventEmitter<void>();
    @Output() saved = new EventEmitter<void>();

    form: FormGroup = this.fb.group({
        title: ['', Validators.required],
        description: ['', Validators.required],
        priority: ['medium', Validators.required],
        type: ['task', Validators.required],
        status: ['backlog', Validators.required]
    });

    isSubmitting = false;

    get modalTitle(): string {
        return this.item ? 'Edit Task' : 'New Task';
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['item'] && this.item) {
            this.form.patchValue(this.item);
        } else if (changes['item'] && !this.item) {
            this.form.reset({
                priority: 'medium',
                type: 'task',
                status: 'backlog'
            });
        }
    }

    async onSubmit() {
        if (this.form.invalid) return;

        this.isSubmitting = true;
        try {
            const formData = this.form.value;

            if (this.item && this.item.id) {
                await this.backlogService.updateItem(this.item.id, formData);
            } else {
                await this.backlogService.createItem(formData);
            }

            this.saved.emit();
        } catch (error) {
            console.error('Error saving backlog item:', error);
        } finally {
            this.isSubmitting = false;
        }
    }
}
