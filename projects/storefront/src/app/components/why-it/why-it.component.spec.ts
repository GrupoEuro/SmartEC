import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WhyItComponent } from './why-it.component';

describe('WhyItComponent', () => {
  let component: WhyItComponent;
  let fixture: ComponentFixture<WhyItComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WhyItComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(WhyItComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
