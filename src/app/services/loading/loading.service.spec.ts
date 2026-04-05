import { TestBed } from '@angular/core/testing';
import { LoadingService } from './loading.service';

describe('LoadingService', () => {
  let service: LoadingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LoadingService);
  });

  it('starts idle', () => {
    expect(service.isLoading()).toBeFalse();
  });

  it('tracks active requests until all are finished', () => {
    service.start();
    service.start();

    expect(service.isLoading()).toBeTrue();

    service.done();
    expect(service.isLoading()).toBeTrue();

    service.done();
    expect(service.isLoading()).toBeFalse();
  });

  it('never decrements below zero', () => {
    service.done();

    expect(service.isLoading()).toBeFalse();
  });
});
