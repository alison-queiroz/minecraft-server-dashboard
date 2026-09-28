import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth/auth.service';
import { ServerService } from '../../services/server/server.service';
import type { LinkErrorCode } from '../../services/user-profile/user-profile.models';
import { AccountLinkError } from '../../services/user-profile/user-profile.models';
import { LinkedAccessService } from '../../services/user-profile/linked-access.service';
import { UserProfileService } from '../../services/user-profile/user-profile.service';

const makeAuthStub = () => ({
  currentUser: signal(null),
  isLoading: signal(false),
  signInWithGoogle: jest.fn().mockResolvedValue(undefined),
  warmUpSignIn: jest.fn(),
  signOut: jest.fn().mockResolvedValue(undefined),
  getIdToken: jest.fn().mockResolvedValue(null),
});

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

const makeProfileStub = () => ({
  loadProfile: jest.fn().mockResolvedValue(undefined),
  linkAccount: jest.fn().mockResolvedValue(undefined),
});

const makeAccessStub = () => ({
  fetchLinkedStatus: jest.fn().mockResolvedValue(false),
});

type ProfileStub = ReturnType<typeof makeProfileStub>;
type AccessStub = ReturnType<typeof makeAccessStub>;

const flushMicrotasks = (): Promise<void> => new Promise<void>((resolve) => queueMicrotask(resolve));

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
        { provide: UserProfileService, useValue: makeProfileStub() },
        { provide: LinkedAccessService, useValue: makeAccessStub() },
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

  it('warms up the sign-in popup when showing the Google step', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    expect(authStub.warmUpSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not warm up the popup for an already signed-in user', () => {
    authStub.currentUser.set({ uid: 'u1' } as never);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    expect(authStub.warmUpSignIn).not.toHaveBeenCalled();
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
    expect(comp.signing()).toBe(false);
  });

  it('shows error message when signInWithGoogle rejects', async () => {
    authStub.signInWithGoogle.mockRejectedValue(new Error('popup_closed_by_user'));
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const errorEl = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(errorEl?.textContent).toContain('popup_closed_by_user');
  });

  it('clears the error and resets signing on subsequent sign-in attempt', async () => {
    authStub.signInWithGoogle.mockRejectedValue(new Error('first error'));
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!;

    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeTruthy();

    authStub.signInWithGoogle.mockResolvedValue(undefined);
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeFalsy();
  });
  it('shows fallback message when rejection is not an Error instance', async () => {
    authStub.signInWithGoogle.mockRejectedValue('not_an_error_object');
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const errorEl = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(errorEl?.textContent).toContain('Sign-in failed. Please try again.');
  });

  it('advances to the Minecraft step after a successful Google sign-in', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const comp = fixture.componentInstance as unknown as { step: ReturnType<typeof signal<string>> };
    expect(comp.step()).toBe('minecraft');
    expect((fixture.nativeElement as HTMLElement).querySelector('#mc-name')).toBeTruthy();
  });

  it('shows an error when submitting Minecraft credentials with missing fields', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const comp = fixture.componentInstance as unknown as {
      step: ReturnType<typeof signal<string>>;
      submitMinecraft(): Promise<void>;
    };
    (comp.step as ReturnType<typeof signal<string>> & { set(v: string): void }).set('minecraft');
    fixture.detectChanges();
    await comp.submitMinecraft();
    fixture.detectChanges();
    const errorEl = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(errorEl?.textContent).toContain('Please enter your in-game name and password.');
  });

  interface McComp {
    step: ReturnType<typeof signal<string>> & { set(v: string): void };
    mcName: ReturnType<typeof signal<string>> & { set(v: string): void };
    mcPassword: ReturnType<typeof signal<string>> & { set(v: string): void };
    submitMinecraft(): Promise<void>;
  }

  const minecraftStep = (name = 'Steve', password = 'secret') => {
    const fixture = TestBed.createComponent(LoginComponent);
    const comp = fixture.componentInstance as unknown as McComp;
    comp.step.set('minecraft');
    comp.mcName.set(name);
    comp.mcPassword.set(password);
    fixture.detectChanges();
    return { fixture, comp };
  };

  const alertText = (fixture: { nativeElement: HTMLElement }): string | null | undefined =>
    fixture.nativeElement.querySelector('[role="alert"]')?.textContent;

  it.each<[LinkErrorCode, string]>([
    ['invalid_credentials', 'Incorrect in-game credentials'],
    ['rate_limited', 'Too many attempts'],
    ['unavailable', 'temporarily unavailable'],
  ])('shows the %s message when linking is refused', async (code: LinkErrorCode, message: string) => {
    const profileStub = TestBed.inject(UserProfileService) as unknown as ProfileStub;
    profileStub.linkAccount.mockRejectedValueOnce(new AccountLinkError(code));
    const { fixture, comp } = minecraftStep('Steve', 'wrongpassword');

    await comp.submitMinecraft();
    fixture.detectChanges();

    expect(alertText(fixture)).toContain(message);
  });

  it('shows a generic message for unexpected link errors', async () => {
    const profileStub = TestBed.inject(UserProfileService) as unknown as ProfileStub;
    profileStub.linkAccount.mockRejectedValueOnce(new Error('boom'));
    const { fixture, comp } = minecraftStep();

    await comp.submitMinecraft();
    fixture.detectChanges();

    expect(alertText(fixture)).toContain('Verification failed. Please try again.');
  });

  it('links through the server in one call and navigates to / on success', async () => {
    const profileStub = TestBed.inject(UserProfileService) as unknown as ProfileStub;
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { comp } = minecraftStep(' Steve ', 'correct');

    await comp.submitMinecraft();

    expect(profileStub.linkAccount).toHaveBeenCalledWith('java', 'Steve', 'correct');
    expect(navigate).toHaveBeenCalledWith(['/']);
  });

  it('lets an already-linked user straight in after Google sign-in (any account type, no Firestore)', async () => {
    const profileStub = TestBed.inject(UserProfileService) as unknown as ProfileStub;
    const accessStub = TestBed.inject(LinkedAccessService) as unknown as AccessStub;
    accessStub.fetchLinkedStatus.mockResolvedValue(true);
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.login-button')!.click();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(profileStub.loadProfile).not.toHaveBeenCalled();
  });

  it('on init, routes a signed-in user by linked status', async () => {
    const profileStub = TestBed.inject(UserProfileService) as unknown as ProfileStub;
    const accessStub = TestBed.inject(LinkedAccessService) as unknown as AccessStub;
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (authStub.currentUser as unknown as { set(v: object): void }).set({ uid: 'u' });

    accessStub.fetchLinkedStatus.mockResolvedValueOnce(true);
    await TestBed.createComponent(LoginComponent).componentInstance.ngOnInit();
    expect(navigate).toHaveBeenCalledWith(['/']);

    accessStub.fetchLinkedStatus.mockResolvedValueOnce(false);
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.componentInstance.ngOnInit();
    expect((fixture.componentInstance as unknown as McComp).step()).toBe('minecraft');
    expect(profileStub.loadProfile).not.toHaveBeenCalled();
  });
});
