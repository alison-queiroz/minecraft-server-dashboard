import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { BackupListComponent } from './backup-list.component';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

describe('BackupListComponent', () => {
  let component: BackupListComponent;
  let fixture: ComponentFixture<BackupListComponent>;
  let httpMock: HttpTestingController;

  beforeAll(() => {
    // Initialize a dummy Firebase app to prevent the "No Firebase App" error during tests
    if (getApps().length === 0) {
      initializeApp({
        apiKey: 'test-key',
        projectId: 'test-project',
        appId: '123',
      });
    }
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BackupListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(BackupListComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    // Ensure currentUser is always null by default to avoid cross-test pollution
    const authInstance = getAuth();
    Object.defineProperty(authInstance, 'currentUser', {
      get: () => null,
      configurable: true,
    });
  });

  afterEach(() => {
    // Ensure that there are no outstanding HTTP requests after each test
    httpMock.verify();

    // Reset currentUser mock to prevent bleed-over to other tests
    const authInstance = getAuth();
    Object.defineProperty(authInstance, 'currentUser', {
      get: () => null,
      configurable: true,
    });
  });

  it('should create and load root folder on init', () => {
    spyOn(component, 'loadCurrentFolder').and.callThrough();

    fixture.detectChanges(); // Triggers ngOnInit

    expect(component).toBeTruthy();
    expect(component.loadCurrentFolder).toHaveBeenCalled();

    const req = httpMock.expectOne('/api/backups');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('should navigate forward to a new folder', () => {
    fixture.detectChanges(); // Initialize
    httpMock.expectOne('/api/backups').flush([]);

    spyOn(component, 'loadCurrentFolder').and.callThrough();
    component.navigateTo('folder-123', 'world');

    expect(component.currentPath()).toEqual([
      { id: null, name: 'Root' },
      { id: 'folder-123', name: 'world' },
    ]);
    expect(component.loadCurrentFolder).toHaveBeenCalled();

    const req = httpMock.expectOne('/api/backups?folderId=folder-123');
    req.flush([]);
  });

  it('should navigate backward to an existing folder and trim the history', () => {
    fixture.detectChanges(); // Initialize
    httpMock.expectOne('/api/backups').flush([]);

    // Mock an existing deep navigation history
    component.currentPath.set([
      { id: null, name: 'Root' },
      { id: '1', name: 'world' },
      { id: '2', name: 'region' },
    ]);

    spyOn(component, 'loadCurrentFolder').and.callThrough();
    component.navigateTo('1', 'world');

    expect(component.currentPath()).toEqual([
      { id: null, name: 'Root' },
      { id: '1', name: 'world' },
    ]);
    expect(component.loadCurrentFolder).toHaveBeenCalled();

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
    expect(component.backups()).toEqual(mockData);
    expect(component.isLoading()).toBeFalse();
  });

  it('should handle API errors gracefully', () => {
    fixture.detectChanges();
    const req = httpMock.expectOne('/api/backups');

    // Simulate a 500 server error
    req.flush('Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(component.backups()).toEqual([]);
    expect(component.isLoading()).toBeFalse();
  });

  it('should fetch backups with an auth token if a user is logged in', fakeAsync(() => {
    const authInstance = getAuth();
    const mockUser = {
      getIdToken: () => Promise.resolve('fake-auth-token'),
    };

    // Use Object.defineProperty to bypass Jasmine's getter check on mocked ES objects
    Object.defineProperty(authInstance, 'currentUser', {
      get: () => mockUser,
      configurable: true,
    });

    let responseData: any;
    component.fetchBackups('folder-123').subscribe((data) => {
      responseData = data;
    });

    // Fast-forward time to resolve the Promise.resolve() from getIdToken()
    tick();

    const req = httpMock.expectOne('/api/backups?folderId=folder-123');
    expect(req.request.headers.get('Authorization')).toBe(
      'Bearer fake-auth-token',
    );
    req.flush([]);

    expect(responseData).toEqual([]);
  }));

  it('should handle token retrieval error if user is logged in but token fails', fakeAsync(() => {
    const authInstance = getAuth();
    const mockUser = {
      getIdToken: () => Promise.reject('Token generation error'),
    };

    // Use Object.defineProperty to bypass Jasmine's getter check on mocked ES objects
    Object.defineProperty(authInstance, 'currentUser', {
      get: () => mockUser,
      configurable: true,
    });

    let responseData: any;
    component.fetchBackups('folder-123').subscribe((data) => {
      responseData = data; // Fallback handles the error and returns an empty array
    });

    // Fast-forward time to resolve the Promise.reject() from getIdToken()
    tick();

    // Verify no HTTP request is made if the token fails
    httpMock.expectNone('/api/backups?folderId=folder-123');
    expect(responseData).toEqual([]);
  }));

  it('should correctly identify if a file is a folder', () => {
    const folder = { mimeType: 'application/vnd.google-apps.folder' } as any;
    const file = { mimeType: 'application/zip' } as any;
    expect(component.isFolder(folder)).toBeTrue();
    expect(component.isFolder(file)).toBeFalse();
  });

  it('should format file sizes correctly', () => {
    expect(component.formatSize(undefined)).toBe('-');
    expect(component.formatSize('0')).toBe('0 B');
    expect(component.formatSize('invalid')).toBe('0 B');
    expect(component.formatSize('1024')).toBe('1 KB');
    expect(component.formatSize('1536')).toBe('1.5 KB');
    expect(component.formatSize('1048576')).toBe('1 MB');
    expect(component.formatSize('1073741824')).toBe('1 GB');
  });
});
