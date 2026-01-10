import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminLogListComponent } from './admin-log-list.component';

describe('AdminLogListComponent', () => {
  let component: AdminLogListComponent;
  let fixture: ComponentFixture<AdminLogListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminLogListComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(AdminLogListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
