import type { OnDestroy } from '@angular/core';
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SkinService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly blobCache = new Map<string, string>();
  async getBlobUrl(url: string): Promise<string> {
    const cached = this.blobCache.get(url);
    if (cached) return cached;

    try {
      const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
      const blobUrl = URL.createObjectURL(blob);
      this.blobCache.set(url, blobUrl);
      return blobUrl;
    } catch {
      return url; // fallback – still renders, just not cached
    }
  }

  ngOnDestroy(): void {
    this.blobCache.forEach(blobUrl => URL.revokeObjectURL(blobUrl));
    this.blobCache.clear();
  }
}
