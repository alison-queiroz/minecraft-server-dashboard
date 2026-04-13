import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { SkinService } from './skin.service';

describe('SkinService', () => {
  let service: SkinService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SkinService,
      ],
    });
    service = TestBed.inject(SkinService);
    httpMock = TestBed.inject(HttpTestingController);
    URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getBlobUrl fetches blob and returns a blob URL', async () => {
    const promise = service.getBlobUrl('https://example.com/skin.png');
    httpMock.expectOne('https://example.com/skin.png').flush(new Blob(['data'], { type: 'image/png' }));

    const result = await promise;
    expect(result).toBe('blob:mock-url');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('getBlobUrl returns cached blob URL on second call without HTTP request', async () => {
    const promise1 = service.getBlobUrl('https://example.com/skin.png');
    httpMock.expectOne('https://example.com/skin.png').flush(new Blob(['data']));
    await promise1;

    const result = await service.getBlobUrl('https://example.com/skin.png');
    httpMock.expectNone('https://example.com/skin.png');
    expect(result).toBe('blob:mock-url');
  });

  it('falls back to the original URL when the HTTP request fails', async () => {
    const promise = service.getBlobUrl('https://example.com/error.png');
    httpMock.expectOne('https://example.com/error.png').error(new ProgressEvent('error'));

    const result = await promise;
    expect(result).toBe('https://example.com/error.png');
  });

  it('ngOnDestroy revokes all cached blob URLs', async () => {
    const promise = service.getBlobUrl('https://example.com/skin.png');
    httpMock.expectOne('https://example.com/skin.png').flush(new Blob(['data']));
    await promise;

    service.ngOnDestroy();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
