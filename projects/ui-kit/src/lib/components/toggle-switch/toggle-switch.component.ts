import { Component, Input, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormControl, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-toggle-switch',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ToggleSwitchComponent),
      multi: true
    }
  ],
  template: `
    <div class="flex items-center">
      <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
        <input type="checkbox" [name]="name" [id]="name" [formControl]="control || fallbackControl" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer"/>
        <label [for]="name" class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
      </div>
      <label [for]="name" class="text-sm text-gray-700 cursor-pointer select-none" *ngIf="label">{{ label }}</label>
    </div>
    <style>
      .toggle-checkbox:checked {
        right: 0;
        border-color: #68D391;
      }
      .toggle-checkbox:checked + .toggle-label {
        background-color: #68D391;
      }
      .toggle-checkbox {
        right: auto;
        border-color: #CBD5E0;
        transition: all 0.3s ease;
      }
    </style>
  `,
  styles: []
})
export class ToggleSwitchComponent implements ControlValueAccessor {
  @Input() label: string = '';
  @Input() name = 'toggle-' + Math.random().toString(36).substring(7);
  @Input() control: FormControl | any;

  fallbackControl = new FormControl(false);

  writeValue(obj: any): void {
    if (obj !== undefined && this.control) {
      if (this.control instanceof FormControl) {
        this.control.setValue(obj);
      }
    } else if (obj !== undefined) {
      this.fallbackControl.setValue(obj);
    }
  }
  registerOnChange(fn: any): void {
    if (this.control && this.control instanceof FormControl) {
      this.control.valueChanges.subscribe(fn);
    } else {
      this.fallbackControl.valueChanges.subscribe(fn);
    }
  }
  registerOnTouched(fn: any): void {
    // onTouched
  }
  setDisabledState?(isDisabled: boolean): void {
    if (this.control && this.control instanceof FormControl) {
      isDisabled ? this.control.disable() : this.control.enable();
    } else {
      isDisabled ? this.fallbackControl.disable() : this.fallbackControl.enable();
    }
  }
}
