import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth/auth.service';
import { ServerService } from '../../services/server/server.service';

/** Minimal AuthService stub */
const makeAuthStub = () => ({
  currentUser: signal(null),
  isLoading: signal(false),
  signInWithGoogle: jasmine.createSpy('signInWithGoogle').and.resolveTo(undefined),
  signOut: jasmine.createSpy('signOut').and.resolveTo(undefined),
  getIdToken: jasmine.createSpy('getIdToken').and.resolveTo(null),
});

/** Minimal ServerService stub — prevents HTTP calls on construction */
const makeServerStub = () => ({
  status: signal('LOADING' as const),
  bedrockStatus: signal('LOADING' as const),
  onlinePlayers: signal(0),
  maxPlayers: signal(0),
  bedrockOnlinePlayers: signal(0),
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

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('LoginComponent', () => {
  let authStub: ReturnType<typeof makeAuthStub>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    authStub = makeAuthStub();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authStub },
        { provide: ServerService, useValue: makeServerStub() },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.match(() => true);
    httpMock.verify();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the Minecraft Dashboard heading', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const h1 = (fixture.nativeElement as HTMLElement).querySelector('h1');
    expect(h1?.textContent).toContain('Minecraft Dashboard');
  });

  it('renders the Sign in with Google button', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('.login-button');
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain('Sign in with Google');
  });

  it('calls signInWithGoogle on button click', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!;
    button.click();
    await flushMicrotasks();
    expect(authStub.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('sets signing signal to false after successful sign-in', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance as unknown as { signing: ReturnType<typeof signal<boolean>> };
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(comp.signing()).toBeFalse();
  });

  it('shows error message when signInWithGoogle rejects', async () => {
    authStub.signInWithGoogle.and.rejectWith(new Error('popup_closed_by_user'));
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const errorEl = (fixture.nativeElement as HTMLElement).querySelector('.login-error');
    expect(errorEl?.textContent).toContain('popup_closed_by_user');
  });

  it('clears the error and resets signing on subsequent sign-in attempt', async () => {
    authStub.signInWithGoogle.and.rejectWith(new Error('first error'));
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!;

    // First attempt — triggers error
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.login-error')).toBeTruthy();

    // Second attempt — error should clear before the next call
    authStub.signInWithGoogle.and.resolveTo(undefined);
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.login-error')).toBeFalsy();
  });
});
