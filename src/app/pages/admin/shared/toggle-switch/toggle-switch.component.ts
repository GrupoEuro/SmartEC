import { Component, Input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-toggle-switch',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './toggle-switch.component.html',
    styleUrls: ['./toggle-switch.component.css']
})
export class ToggleSwitchComponent {
    @Input() control!: FormControl;
    @Input() label!: string;
    @Input() icon?: string;
    @Input() hint?: string;

    // Generate unique internal ID to avoid collision with host element
    internalId = `toggle-${Math.random().toString(36).substr(2, 9)}`;
}
