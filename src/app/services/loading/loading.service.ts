import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly activeRequests = signal(0);

  /** True while at least one tracked HTTP request is in flight. */
  readonly isLoading = computed(() => this.activeRequests() > 0);

  start(): void {
    this.activeRequests.update(n => n + 1);
  }

  done(): void {
    this.activeRequests.update(n => Math.max(0, n - 1));
  }
}
