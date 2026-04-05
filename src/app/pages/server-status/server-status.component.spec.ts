import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { ServerStatusComponent } from './server-status.component';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';
import { AuthService } from '../../services/auth/auth.service';

const makeServerStub = () => ({
  status: signal<string>(SERVER_STATUS.LOADING),
  bedrockStatus: signal<string>(SERVER_STATUS.LOADING),
  onlinePlayers: signal(0),
  maxPlayers: signal(0),
  bedrockOnlinePlayers: signal(0),
  bedrockMaxPlayers: signal(0),
  version: signal<string | null>(null),
  motd: signal<string[]>([]),
  software: signal<string | null>(null),
  hostname: signal<string | null>(null),
  ip: signal<string | null>(null),
  port: signal<number | null>(null),
  protocol: signal<{ version: number; name: string } | null>(null),
  bedrockVersion: signal<string | null>(null),
  bedrockPort: signal<number | null>(null),
  bedrockProtocol: signal<{ version: number; name: string } | null>(null),
});

const makeAuthStub = () => ({
  currentUser: signal(null),
  isLoading: signal(false),
  getIdToken: jest.fn().mockResolvedValue(null),
});

interface ServerStatusTestAccess {
  serverStatus: typeof SERVER_STATUS;
}

function asServerStatusTestAccess(component: ServerStatusComponent): ServerStatusTestAccess {
  return component as unknown as ServerStatusTestAccess;
}

describe('ServerStatusComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServerStatusComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ServerService, useValue: makeServerStub() },
        { provide: AuthService, useValue: makeAuthStub() },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.match(() => true);
    httpMock.verify();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ServerStatusComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('exposes SERVER_STATUS constant on the component', () => {
    const fixture = TestBed.createComponent(ServerStatusComponent);
    const comp = asServerStatusTestAccess(fixture.componentInstance);
    expect(comp.serverStatus).toBe(SERVER_STATUS);
  });

  it('renders the server identity card', () => {
    const fixture = TestBed.createComponent(ServerStatusComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-server-identity-card')).toBeTruthy();
  });

  it('renders the page heading', () => {
    const fixture = TestBed.createComponent(ServerStatusComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Server Status');
  });

  it('renders the back link', () => {
    const fixture = TestBed.createComponent(ServerStatusComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector<HTMLAnchorElement>('a.status-back-link');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('Back');
  });
});




