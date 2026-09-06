import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

// This is a root singleton, so its object-URL cache intentionally lives for the
// app's lifetime. It is bounded by the number of distinct skin URLs, so it is
// not a practical leak — hence no OnDestroy revoke (which would never run on a
// root service anyway and only gave false confidence).
@Injectable({ providedIn: 'root' })
export class SkinService {
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
}
