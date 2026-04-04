import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { BackupService, BackupFile } from './backup.service';

const MOCK_BACKUPS: BackupFile[] = [
  {
    id: 'file-1',
    name: 'backup-2025-01-01.zip',
    mimeType: 'application/zip',
    createdTime: '2025-01-01T00:00:00.000Z',
    size: '10485760',
  },
  {
    id: 'file-2',
    name: 'backup-2025-01-02.zip',
    mimeType: 'application/zip',
    createdTime: '2025-01-02T00:00:00.000Z',
    size: '11534336',
  },
];

describe('BackupService', () => {
  let service: BackupService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BackupService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('calls /api/backups without query params when folderId is null', () => {
    service.getBackups(null).subscribe();

    const req = httpMock.expectOne('/api/backups');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('folderId')).toBeFalse();
    req.flush(MOCK_BACKUPS);
  });

  it('calls /api/backups with folderId query param when provided', () => {
    service.getBackups('folder-abc').subscribe();

    const req = httpMock.expectOne('/api/backups?folderId=folder-abc');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('folderId')).toBe('folder-abc');
    req.flush(MOCK_BACKUPS);
  });

  it('returns the backup list emitted by the server', () => {
    let result: BackupFile[] | undefined;
    service.getBackups(null).subscribe(files => (result = files));

    httpMock.expectOne('/api/backups').flush(MOCK_BACKUPS);
    expect(result).toEqual(MOCK_BACKUPS);
  });

  it('returns an empty array when the HTTP request fails', () => {
    let result: BackupFile[] | undefined;
    service.getBackups(null).subscribe(files => (result = files));

    httpMock.expectOne('/api/backups').flush(
      { message: 'Server Error' },
      { status: 500, statusText: 'Internal Server Error' }
    );

    expect(result).toEqual([]);
  });
});
