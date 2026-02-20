import { TestBed } from '@angular/core/testing';

import { AdminLogService } from './admin-log.service';

describe('AdminLogService', () => {
  let service: AdminLogService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AdminLogService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
