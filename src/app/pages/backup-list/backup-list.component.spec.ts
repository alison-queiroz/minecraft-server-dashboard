import { TestBed, fakeAsync, tick, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { throwError } from 'rxjs';
import { BackupService, type BackupFile } from '../../services/backup/backup.service';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { BackupListComponent, type NavigationPath } from './backup-list.component';

type WritableSignalLike<T> = (() => T) & {
  set(value: T): void;
  update(updater: (value: T) => T): void;
};

interface BackupListTestAccess {
  currentPath: WritableSignalLike<NavigationPath[]>;
  backups: WritableSignalLike<BackupFile[]>;
  loadCurrentFolder(): void;
  navigateTo(folderId: string | null, folderName: string): void;
  isFolder(file: BackupFile): boolean;
  formatSize(bytesStr?: string): string;
  trackByBackupId(index: number, backup: BackupFile): string;
  resizeObserver?: ResizeObserver;
}

function asBackupListTestAccess(component: BackupListComponent): BackupListTestAccess {
  return component as unknown as BackupListTestAccess;
}

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
    const cmp = asBackupListTestAccess(component);
    const loadCurrentFolderSpy = spyOn(cmp, 'loadCurrentFolder').and.callThrough();

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

    const cmp = asBackupListTestAccess(component);
    const loadCurrentFolderSpy = spyOn(cmp, 'loadCurrentFolder').and.callThrough();
    cmp.navigateTo('folder-123', 'world');

    expect(cmp.currentPath()).toEqual([
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

    const cmp = asBackupListTestAccess(component);
    cmp.currentPath.set([
      { id: null, name: 'Root' },
      { id: '1', name: 'world' },
      { id: '2', name: 'region' },
    ]);

    const loadCurrentFolderSpy = spyOn(cmp, 'loadCurrentFolder').and.callThrough();
    cmp.navigateTo('1', 'world');

    expect(cmp.currentPath()).toEqual([
      { id: null, name: 'Root' },
      { id: '1', name: 'world' },
    ]);
    expect(loadCurrentFolderSpy).toHaveBeenCalled();

    const req = httpMock.expectOne('/api/backups?folderId=1');
    req.flush([]);
  });

  it('should handle API success correctly and populate backups', () => {
    fixture.detectChanges();
    const cmp = asBackupListTestAccess(component);
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
    expect(cmp.backups()).toEqual(mockData);
  });

  it('should handle API errors gracefully', () => {
    fixture.detectChanges();
    const cmp = asBackupListTestAccess(component);
    spyOn(console, 'error');
    const req = httpMock.expectOne('/api/backups');

    req.flush('Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(console.error).toHaveBeenCalled();
    expect(cmp.backups()).toEqual([]);
  });

  it('loadCurrentFolder catchError logs and leaves backups untouched on parse error', () => {
    // Bypass BackupService's own catchError by making getBackups throw directly
    const cmp = asBackupListTestAccess(component);
    const backupService = TestBed.inject(BackupService);
    spyOn(backupService, 'getBackups').and.returnValue(throwError(() => new Error('parse error')));

    spyOn(console, 'error');
    cmp.loadCurrentFolder();

    expect(console.error).toHaveBeenCalledWith(
      jasmine.stringContaining('Failed to parse backups'),
      jasmine.anything()
    );
    expect(cmp.backups()).toEqual([]);
  });

  it('should request the current folder when loadCurrentFolder runs', fakeAsync(() => {
    const cmp = asBackupListTestAccess(component);
    cmp.currentPath.set([
      { id: null, name: 'Root' },
      { id: 'folder-123', name: 'world' },
    ]);

    cmp.loadCurrentFolder();
    tick();

    const req = httpMock.expectOne('/api/backups?folderId=folder-123');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  }));

  it('should correctly identify if a file is a folder', () => {
    const cmp = asBackupListTestAccess(component);
    const folder: BackupFile = {
      id: 'folder-1',
      name: 'folder',
      mimeType: 'application/vnd.google-apps.folder',
      createdTime: '2026-01-01T00:00:00Z',
    };
    const file: BackupFile = {
      id: 'file-1',
      name: 'file.zip',
      mimeType: 'application/zip',
      createdTime: '2026-01-01T00:00:00Z',
    };
    expect(cmp.isFolder(folder)).toBeTrue();
    expect(cmp.isFolder(file)).toBeFalse();
  });

  it('should format file sizes correctly', () => {
    const cmp = asBackupListTestAccess(component);
    expect(cmp.formatSize(undefined)).toBe('-');
    expect(cmp.formatSize('0')).toBe('0 B');
    expect(cmp.formatSize('invalid')).toBe('0 B');
    expect(cmp.formatSize('1024')).toBe('1 KB');
    expect(cmp.formatSize('1536')).toBe('1.5 KB');
    expect(cmp.formatSize('1048576')).toBe('1 MB');
    expect(cmp.formatSize('1073741824')).toBe('1 GB');
  });

  it('trackByBackupId returns the backup id', () => {
    const cmp = asBackupListTestAccess(component);
    const backup: BackupFile = {
      id: 'abc-123',
      name: 'test.zip',
      mimeType: 'application/zip',
      createdTime: '2026-01-01T00:00:00Z',
    };
    expect(cmp.trackByBackupId(0, backup)).toBe('abc-123');
  });

  it('ngOnDestroy disconnects the ResizeObserver', () => {
    fixture.detectChanges();
    httpMock.expectOne('/api/backups').flush([]);

    const cmp = asBackupListTestAccess(component);
    const observer = cmp.resizeObserver;
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
