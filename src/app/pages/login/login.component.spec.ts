import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth/auth.service';
import { ServerService } from '../../services/server/server.service';
import { UserProfileService } from '../../services/user-profile/user-profile.service';
import { MinecraftCredentialService } from '../../services/minecraft-credential/minecraft-credential.service';

const makeAuthStub = () => ({
  currentUser: signal(null),
  isLoading: signal(false),
  signInWithGoogle: jest.fn().mockResolvedValue(undefined),
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
  minecraftAccounts: signal({ java: null as string | null, bedrock: null, admin: null }),
  isLoading: signal(false),
  isLoaded: signal(false),
  loadProfile: jest.fn().mockResolvedValue(undefined),
  linkAccount: jest.fn().mockResolvedValue(undefined),
});

const makeMinecraftStub = () => ({
  verify: jest.fn().mockResolvedValue(true),
});

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
        { provide: MinecraftCredentialService, useValue: makeMinecraftStub() },
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

  it('shows an error when the Minecraft credentials are invalid', async () => {
    const mcStub = TestBed.inject(MinecraftCredentialService) as unknown as { verify: ReturnType<typeof jest.fn> };
    mcStub.verify.mockResolvedValueOnce(false);

    const fixture = TestBed.createComponent(LoginComponent);
    const comp = fixture.componentInstance as unknown as {
      step: ReturnType<typeof signal<string>> & { set(v: string): void };
      mcName: ReturnType<typeof signal<string>> & { set(v: string): void };
      mcPassword: ReturnType<typeof signal<string>> & { set(v: string): void };
      submitMinecraft(): Promise<void>;
    };
    comp.step.set('minecraft');
    comp.mcName.set('Steve');
    comp.mcPassword.set('wrongpassword');
    fixture.detectChanges();

    await comp.submitMinecraft();
    fixture.detectChanges();

    const errorEl = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(errorEl?.textContent).toContain('Incorrect in-game credentials');
  });

  it('links the account and navigates to / when credentials are valid', async () => {
    const profileStub = TestBed.inject(UserProfileService) as unknown as {
      linkAccount: ReturnType<typeof jest.fn>;
    };

    const fixture = TestBed.createComponent(LoginComponent);
    const comp = fixture.componentInstance as unknown as {
      step: ReturnType<typeof signal<string>> & { set(v: string): void };
      mcName: ReturnType<typeof signal<string>> & { set(v: string): void };
      mcPassword: ReturnType<typeof signal<string>> & { set(v: string): void };
      submitMinecraft(): Promise<void>;
    };
    comp.step.set('minecraft');
    comp.mcName.set('Steve');
    comp.mcPassword.set('correct');
    fixture.detectChanges();

    await comp.submitMinecraft();

    expect(profileStub.linkAccount).toHaveBeenCalledWith('java', 'Steve');
  });
});




