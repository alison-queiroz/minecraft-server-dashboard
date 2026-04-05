import { TestBed } from '@angular/core/testing';
import { LoadingService } from './loading.service';

describe('LoadingService', () => {
  let service: LoadingService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [],
    });
    service = TestBed.inject(LoadingService);
  });

  it('starts idle', () => {
    expect(service.isLoading()).toBe(false);
  });

  it('tracks active requests until all are finished', () => {
    service.start();
    service.start();

    expect(service.isLoading()).toBe(true);

    service.done();
    expect(service.isLoading()).toBe(true);

    service.done();
    expect(service.isLoading()).toBe(false);
  });

  it('never decrements below zero', () => {
    service.done();

    expect(service.isLoading()).toBe(false);
  });
});





