import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import type { User } from 'firebase/auth';
import type { Mock } from 'vitest';

import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth/auth.service';
import { UserProfileService } from '../services/user-profile/user-profile.service';

const makeProfileStub = (hasLinkedAccount = true) => ({
  fetchLinkedStatus: jest.fn().mockResolvedValue(hasLinkedAccount),
});

describe('authGuard', () => {
  let isLoading = signal(false);
  let currentUser = signal<User | null>(null);
  let mockRouter: { navigate: Mock };
  let profileStub: ReturnType<typeof makeProfileStub>;

  beforeEach(() => {
    isLoading = signal(false);
    currentUser = signal<User | null>(null);
    mockRouter = { navigate: jest.fn() };
    profileStub = makeProfileStub(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isLoading, currentUser } },
        { provide: Router, useValue: mockRouter },
        { provide: UserProfileService, useValue: profileStub },
      ],
    });
  });

  function runGuard(): Promise<boolean> {
    return firstValueFrom(
      TestBed.runInInjectionContext(
        () => authGuard({} as never, {} as never),
      ) as Observable<boolean>,
    );
  }

  it('returns true when the user is authenticated and has a linked Java account', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    expect(await runGuard()).toBe(true);
  });

  it('navigates to /login and returns false for an unauthenticated user', async () => {
    currentUser.set(null);
    const result = await runGuard();
    expect(result).toBe(false);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('does not navigate to /login when the user is authenticated and has a linked Java account', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    await runGuard();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('redirects to /login when Firebase-authed but no account is linked', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    profileStub.fetchLinkedStatus.mockResolvedValue(false);
    const result = await runGuard();
    expect(result).toBe(false);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('checks linked-account status (over HTTP, not client Firestore) before allowing', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    await runGuard();
    expect(profileStub.fetchLinkedStatus).toHaveBeenCalled();
  });
});




