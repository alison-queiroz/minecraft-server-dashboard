import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { NavComponent } from './nav.component';
import { ServerService } from '../../../services/server/server.service';
import { AuthService } from '../../../services/auth/auth.service';

const makeServerStub = () => ({
  status: signal('LOADING' as const),
  bedrockStatus: signal('LOADING' as const),
  onlinePlayers: signal(0),
  maxPlayers: signal(0),
  bedrockOnlinePlayers: signal(0),
  bedrockMaxPlayers: signal(0),
  version: signal(null),
  motd: signal([]),
  software: signal(null),
  hostname: signal(null),
  ip: signal(null),
  port: signal(null),
  protocol: signal(null),
  bedrockVersion: signal(null),
  bedrockPort: signal(null),
  bedrockProtocol: signal(null),
});

const makeAuthStub = () => ({
  currentUser: signal(null),
  isLoading: signal(false),
  signInWithGoogle: jasmine.createSpy('signInWithGoogle').and.resolveTo(undefined),
  signOut: jasmine.createSpy('signOut').and.resolveTo(undefined),
  getIdToken: jasmine.createSpy('getIdToken').and.resolveTo(null),
});

type SignalGetter<T> = () => T;

interface NavTestAccess {
  menuOpen: SignalGetter<boolean>;
}

function asNavTestAccess(component: NavComponent): NavTestAccess {
  return component as unknown as NavTestAccess;
}

describe('NavComponent', () => {
  let fixture: ComponentFixture<NavComponent>;
  let component: NavComponent;
  let authStub: ReturnType<typeof makeAuthStub>;

  beforeEach(async () => {
    authStub = makeAuthStub();

    await TestBed.configureTestingModule({
      imports: [NavComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideRouter([]),
        { provide: ServerService, useValue: makeServerStub() },
        { provide: AuthService, useValue: authStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('menuOpen starts false', () => {
    expect(asNavTestAccess(component).menuOpen()).toBeFalse();
  });

  it('toggleMenu flips menuOpen true', () => {
    component.toggleMenu();
    expect(asNavTestAccess(component).menuOpen()).toBeTrue();
  });

  it('toggleMenu flips menuOpen back to false', () => {
    component.toggleMenu();
    component.toggleMenu();
    expect(asNavTestAccess(component).menuOpen()).toBeFalse();
  });

  it('closeMenu sets menuOpen to false', () => {
    component.toggleMenu(); // set true first
    component.closeMenu();
    expect(asNavTestAccess(component).menuOpen()).toBeFalse();
  });

  it('signOut closes menu and calls auth.signOut()', async () => {
    component.toggleMenu();
    await component.signOut();
    expect(asNavTestAccess(component).menuOpen()).toBeFalse();
    expect(authStub.signOut).toHaveBeenCalled();
  });
});
