import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DistributorFormComponent } from './distributor-form.component';

describe('DistributorFormComponent', () => {
  let component: DistributorFormComponent;
  let fixture: ComponentFixture<DistributorFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DistributorFormComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(DistributorFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
