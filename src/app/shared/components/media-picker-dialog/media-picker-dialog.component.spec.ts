import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MediaPickerDialogComponent } from './media-picker-dialog.component';

describe('MediaPickerDialogComponent', () => {
  let component: MediaPickerDialogComponent;
  let fixture: ComponentFixture<MediaPickerDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MediaPickerDialogComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(MediaPickerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
