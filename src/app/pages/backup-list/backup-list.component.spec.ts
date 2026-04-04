import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { throwError } from 'rxjs';
import { BackupService } from '../../services/backup/backup.service';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { BackupListComponent } from './backup-list.component';

describe('BackupListComponent', () => {
  let component: BackupListComponent;
  let fixture: ComponentFixture<BackupListComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BackupListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(BackupListComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create and load root folder on init', () => {
    const loadCurrentFolderSpy = spyOn<any>(component, 'loadCurrentFolder').and.callThrough();

    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(loadCurrentFolderSpy).toHaveBeenCalled();

    const req = httpMock.expectOne('/api/backups');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('should navigate forward to a new folder', () => {
    fixture.detectChanges();
    httpMock.expectOne('/api/backups').flush([]);

    const loadCurrentFolderSpy = spyOn<any>(component, 'loadCurrentFolder').and.callThrough();
    (component as any).navigateTo('folder-123', 'world');

    expect((component as any).currentPath()).toEqual([
      { id: null, name: 'Root' },
      { id: 'folder-123', name: 'world' },
    ]);
    expect(loadCurrentFolderSpy).toHaveBeenCalled();

    const req = httpMock.expectOne('/api/backups?folderId=folder-123');
    req.flush([]);
  });

  it('should navigate backward to an existing folder and trim the history', () => {
    fixture.detectChanges();
    httpMock.expectOne('/api/backups').flush([]);

    (component as any).currentPath.set([
      { id: null, name: 'Root' },
      { id: '1', name: 'world' },
      { id: '2', name: 'region' },
    ]);

    const loadCurrentFolderSpy = spyOn<any>(component, 'loadCurrentFolder').and.callThrough();
    (component as any).navigateTo('1', 'world');

    expect((component as any).currentPath()).toEqual([
      { id: null, name: 'Root' },
      { id: '1', name: 'world' },
    ]);
    expect(loadCurrentFolderSpy).toHaveBeenCalled();

    const req = httpMock.expectOne('/api/backups?folderId=1');
    req.flush([]);
  });

  it('should handle API success correctly and populate backups', () => {
    fixture.detectChanges();
    const req = httpMock.expectOne('/api/backups');

    const mockData = [
      {
        id: '1',
        name: 'file.zip',
        mimeType: 'application/zip',
        createdTime: '2026-03-30T00:00:00Z',
        size: '1024',
      },
    ];

    req.flush(mockData);
    expect((component as any).backups()).toEqual(mockData);
    expect((component as any).isLoading()).toBeFalse();
  });

  it('should handle API errors gracefully', () => {
    fixture.detectChanges();
    const req = httpMock.expectOne('/api/backups');

    req.flush('Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect((component as any).backups()).toEqual([]);
    expect((component as any).isLoading()).toBeFalse();
  });

  it('loadCurrentFolder catchError logs and resets isLoading on parse error', () => {
    // Bypass BackupService's own catchError by making getBackups throw directly
    const backupService = TestBed.inject(BackupService);
    spyOn(backupService, 'getBackups').and.returnValue(throwError(() => new Error('parse error')));

    spyOn(console, 'error');
    (component as any).loadCurrentFolder();

    expect(console.error).toHaveBeenCalledWith(
      jasmine.stringContaining('Failed to parse backups'),
      jasmine.anything()
    );
    expect((component as any).isLoading()).toBeFalse();
  });

  it('should request the current folder when loadCurrentFolder runs', fakeAsync(() => {
    (component as any).currentPath.set([
      { id: null, name: 'Root' },
      { id: 'folder-123', name: 'world' },
    ]);

    (component as any).loadCurrentFolder();
    tick();

    const req = httpMock.expectOne('/api/backups?folderId=folder-123');
    req.flush([]);
  }));

  it('should correctly identify if a file is a folder', () => {
    const folder = { mimeType: 'application/vnd.google-apps.folder' } as any;
    const file = { mimeType: 'application/zip' } as any;
    expect((component as any).isFolder(folder)).toBeTrue();
    expect((component as any).isFolder(file)).toBeFalse();
  });

  it('should format file sizes correctly', () => {
    expect((component as any).formatSize(undefined)).toBe('-');
    expect((component as any).formatSize('0')).toBe('0 B');
    expect((component as any).formatSize('invalid')).toBe('0 B');
    expect((component as any).formatSize('1024')).toBe('1 KB');
    expect((component as any).formatSize('1536')).toBe('1.5 KB');
    expect((component as any).formatSize('1048576')).toBe('1 MB');
    expect((component as any).formatSize('1073741824')).toBe('1 GB');
  });

  it('trackByBackupId returns the backup id', () => {
    const backup = { id: 'abc-123', name: 'test.zip' } as any;
    expect((component as any).trackByBackupId(0, backup)).toBe('abc-123');
  });

  it('ngOnDestroy disconnects the ResizeObserver', () => {
    fixture.detectChanges();
    httpMock.expectOne('/api/backups').flush([]);

    const observer = (component as any).resizeObserver as ResizeObserver;
    if (observer) {
      const disconnectSpy = spyOn(observer, 'disconnect');
      fixture.destroy();
      expect(disconnectSpy).toHaveBeenCalled();
    } else {
      // ResizeObserver not available — just verify destroy doesn't throw
      expect(() => fixture.destroy()).not.toThrow();
    }
  });
});
