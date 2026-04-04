import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import type { User } from 'firebase/auth';

import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth/auth.service';

describe('authGuard', () => {
  let isLoading = signal(false);
  let currentUser = signal<User | null>(null);
  let mockRouter: jasmine.SpyObj<Router>;

  beforeEach(() => {
    // Re-create signals so each test starts fresh.
    isLoading = signal(false);
    currentUser = signal<User | null>(null);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isLoading, currentUser } },
        { provide: Router, useValue: mockRouter },
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

  it('returns true when the user is authenticated', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    expect(await runGuard()).toBeTrue();
  });

  it('navigates to /login and returns false for an unauthenticated user', async () => {
    currentUser.set(null);
    const result = await runGuard();
    expect(result).toBeFalse();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('does not navigate to /login when the user is authenticated', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    await runGuard();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });
});
