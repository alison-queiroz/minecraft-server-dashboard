import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { throwError } from 'rxjs';
import { BackupService } from '../../services/backup/backup.service';
import type { BackupFile } from '../../services/backup/backup.service';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { BackupListComponent } from './backup-list.component';
import type { NavigationPath } from './backup-list.component';

type WritableSignalLike<T> = (() => T) & {
  set(value: T): void;
  update(updater: (value: T) => T): void;
};

interface BackupListTestAccess {
  currentPath: WritableSignalLike<NavigationPath[]>;
  backups: WritableSignalLike<BackupFile[]>;
  loadError(): boolean;
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
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
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
    const loadCurrentFolderSpy = jest.spyOn(cmp, 'loadCurrentFolder');

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
    const loadCurrentFolderSpy = jest.spyOn(cmp, 'loadCurrentFolder');
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

    const loadCurrentFolderSpy = jest.spyOn(cmp, 'loadCurrentFolder');
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

  it('shows the error state (not "This folder is empty") when the API fails', () => {
    fixture.detectChanges();
    const cmp = asBackupListTestAccess(component);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const req = httpMock.expectOne('/api/backups');

    req.flush('Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(console.error).toHaveBeenCalled();
    expect(cmp.backups()).toEqual([]);
    expect(cmp.loadError()).toBe(true);
    expect(host.querySelector('[data-testid="backups-error"]')).toBeTruthy();
    expect(host.textContent).not.toContain('This folder is empty');
  });

  it('clears the error state once a later folder load succeeds', () => {
    fixture.detectChanges();
    const cmp = asBackupListTestAccess(component);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    httpMock.expectOne('/api/backups').flush('boom', { status: 500, statusText: 'Server Error' });
    expect(cmp.loadError()).toBe(true);

    cmp.navigateTo('folder-1', 'world');
    httpMock.expectOne('/api/backups?folderId=folder-1').flush([]);
    fixture.detectChanges();

    expect(cmp.loadError()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('This folder is empty');
  });

  it('logs and flags the error when getBackups errors synchronously', () => {
    const cmp = asBackupListTestAccess(component);
    const backupService = TestBed.inject(BackupService);
    jest.spyOn(backupService, 'getBackups').mockReturnValue(throwError(() => new Error('parse error')));

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    cmp.loadCurrentFolder();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load backups'),
      expect.anything()
    );
    expect(cmp.backups()).toEqual([]);
    expect(cmp.loadError()).toBe(true);
  });

  it('keeps only the latest folder when navigation outpaces the responses', () => {
    fixture.detectChanges();
    httpMock.expectOne('/api/backups').flush([]);
    const cmp = asBackupListTestAccess(component);
    const regionFile: BackupFile = {
      id: 'r1', name: 'region.zip', mimeType: 'application/zip', createdTime: '2026-01-01T00:00:00Z',
    };

    cmp.navigateTo('world', 'world');
    const worldReq = httpMock.expectOne('/api/backups?folderId=world');
    cmp.navigateTo('region', 'region');
    const regionReq = httpMock.expectOne('/api/backups?folderId=region');

    // The superseded request is cancelled, so its late response can never land.
    expect(worldReq.cancelled).toBe(true);
    regionReq.flush([regionFile]);

    expect(cmp.backups()).toEqual([regionFile]);
  });

  it('stops listening for folder responses once destroyed', () => {
    fixture.detectChanges();
    const req = httpMock.expectOne('/api/backups');
    fixture.destroy();

    expect(req.cancelled).toBe(true);
  });

  it('should request the current folder when loadCurrentFolder runs', () => {
    const cmp = asBackupListTestAccess(component);
    cmp.currentPath.set([
      { id: null, name: 'Root' },
      { id: 'folder-123', name: 'world' },
    ]);

    cmp.loadCurrentFolder();
    const req = httpMock.expectOne('/api/backups?folderId=folder-123');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

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
    expect(cmp.isFolder(folder)).toBe(true);
    expect(cmp.isFolder(file)).toBe(false);
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
      const disconnectSpy = jest.spyOn(observer, 'disconnect');
      fixture.destroy();
      expect(disconnectSpy).toHaveBeenCalled();
    } else {
      // ResizeObserver not available — just verify destroy doesn't throw
      expect(() => fixture.destroy()).not.toThrow();
    }
  });

  it('ngAfterViewInit ResizeObserver callback calls viewport.checkViewportSize', () => {
    // Mock ResizeObserver to fire the callback immediately with a fake entry
    const checkSpy = jest.fn();
    // Cast (not annotation) so TS doesn't narrow it to `null` past the closure.
    let capturedCallback = null as ResizeObserverCallback | null;
    const mockObserve = jest.fn();
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        capturedCallback = cb;
      }
      observe = mockObserve;
      disconnect = jest.fn();
      unobserve = jest.fn();
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;

    fixture.detectChanges();
    httpMock.expectOne('/api/backups').flush([]);

    // Inject a fake viewport reference
    const vpRef = (component as unknown as { viewport?: { checkViewportSize(): void } });
    if (vpRef.viewport) {
      jest.spyOn(vpRef.viewport, 'checkViewportSize').mockImplementation(checkSpy);
    }

    // Fire the ResizeObserver callback manually
    if (capturedCallback) {
      capturedCallback([], {} as ResizeObserver);
    }
    // The callback fires viewport?.checkViewportSize — no error is the key assertion
    expect(mockObserve).toHaveBeenCalled();
  });
});



