import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UserAvatarComponent } from './user-avatar.component';
import { AuthService } from '../../../services/auth/auth.service';

const makeAuthStub = (photoURL?: string) => ({
  currentUser: signal(photoURL ? { photoURL, displayName: 'Test User' } as any : null),
  isLoading: signal(false),
  getIdToken: jasmine.createSpy('getIdToken').and.resolveTo(null),
  signInWithGoogle: jasmine.createSpy('signInWithGoogle').and.resolveTo(undefined),
  signOut: jasmine.createSpy('signOut').and.resolveTo(undefined),
});

describe('UserAvatarComponent', () => {
  let fixture: ComponentFixture<UserAvatarComponent>;

  async function setup(authStub = makeAuthStub()) {
    await TestBed.configureTestingModule({
      imports: [UserAvatarComponent],
      providers: [{ provide: AuthService, useValue: authStub }],
    }).compileComponents();
    fixture = TestBed.createComponent(UserAvatarComponent);
    return fixture;
  }

  it('should create', async () => {
    await setup();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('default size is sm', async () => {
    await setup();
    fixture.detectChanges();
    expect(fixture.componentInstance.size).toBe('sm');
  });

  it('sets data-size attribute when size is lg', async () => {
    await setup();
    fixture.componentInstance.size = 'lg';
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-size')).toBe('lg');
  });

  it('renders img when currentUser has photoURL', async () => {
    await setup(makeAuthStub('https://example.com/photo.jpg'));
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img.avatar-img');
    expect(img).toBeTruthy();
    expect(img.src).toContain('photo.jpg');
  });

  it('renders nothing when currentUser is null', async () => {
    await setup(makeAuthStub());
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img.avatar-img');
    expect(img).toBeNull();
  });
});
