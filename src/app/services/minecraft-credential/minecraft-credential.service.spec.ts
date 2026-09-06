import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MinecraftCredentialService } from './minecraft-credential.service';

describe('MinecraftCredentialService', () => {
  let service: MinecraftCredentialService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MinecraftCredentialService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MinecraftCredentialService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('POSTs {username,password} and resolves to the server valid flag', async () => {
    const promise = service.verify('Steve', 'pw');
    const req = httpMock.expectOne('/api/verify-minecraft-password');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'Steve', password: 'pw' });
    req.flush({ valid: true });
    expect(await promise).toBe(true);
  });

  it('resolves false when the server reports invalid credentials', async () => {
    const promise = service.verify('Steve', 'wrong');
    httpMock.expectOne('/api/verify-minecraft-password').flush({ valid: false });
    expect(await promise).toBe(false);
  });

  it('rejects (does not swallow) on a 5xx server error', async () => {
    const promise = service.verify('Steve', 'pw');
    httpMock
      .expectOne('/api/verify-minecraft-password')
      .flush('err', { status: 500, statusText: 'Server Error' });
    await expect(promise).rejects.toBeTruthy();
  });
});
