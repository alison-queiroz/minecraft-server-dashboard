import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, from, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { getAuth } from 'firebase/auth';

export interface BackupFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
  webContentLink?: string;
}

export interface NavigationPath {
  id: string | null;
  name: string;
}

@Component({
  selector: 'app-backup-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="max-w-5xl mx-auto p-6 md:p-10">
      <div class="bg-zinc-900 rounded-3xl border border-zinc-800 overflow-hidden shadow-xl">

        <!-- Header -->
        <div class="p-5 border-b border-zinc-800 flex items-center justify-between">
          <h3 class="text-[10px] uppercase font-black tracking-widest text-zinc-500 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" x2="2" y1="12" y2="12"/>
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
              <line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>
            </svg>
            Server Backups
          </h3>
        </div>

        <!-- Breadcrumbs -->
        <div class="px-5 py-4 bg-zinc-900/50 border-b border-zinc-800 flex items-center flex-wrap gap-2">
          @for (path of currentPath(); track path.id; let last = $last) {
            <div class="flex items-center">
              <button
                (click)="navigateTo(path.id, path.name)"
                [class.text-emerald-400]="!last"
                [class.hover:text-emerald-300]="!last"
                [class.text-zinc-500]="last"
                [disabled]="last"
                class="text-[10px] font-black uppercase tracking-widest focus:outline-none transition-colors"
              >
                {{ path.name }}
              </button>
              @if (!last) {
                <span class="mx-3 text-zinc-700 font-bold">/</span>
              }
            </div>
          }
        </div>

        <!-- Backup List -->
        <div class="divide-y divide-zinc-800">
          @if (isLoading()) {
            <div class="p-12 text-center text-[10px] font-black uppercase tracking-widest text-zinc-600 animate-pulse">
              Loading contents...
            </div>
          } @else {
            @for (backup of backups(); track backup.id) {
              <div class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-800/30 transition-colors">

                <div class="flex items-center gap-4 min-w-0">
                  <!-- Icon Box -->
                  <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0"
                       [class.text-emerald-400]="isFolder(backup)"
                       [class.text-zinc-500]="!isFolder(backup)">
                    @if (isFolder(backup)) {
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
                      </svg>
                    } @else {
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>
                        <circle cx="8" cy="16" r="2"/><path d="M8 10V7"/><path d="M8 14v-2"/>
                      </svg>
                    }
                  </div>

                  <!-- Info -->
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-zinc-200 truncate cursor-pointer hover:text-emerald-400 transition-colors"
                       (click)="isFolder(backup) ? navigateTo(backup.id, backup.name) : null">
                      {{ backup.name }}
                    </p>
                    <div class="flex items-center flex-wrap gap-2 mt-1.5 text-[10px] uppercase font-black tracking-widest text-zinc-600">
                      <span>{{ backup.createdTime | date: 'medium' }}</span>
                      @if (!isFolder(backup)) {
                        <span class="w-1 h-1 rounded-full bg-zinc-700 hidden sm:inline-block"></span>
                        <span class="text-zinc-500">{{ formatSize(backup.size) }}</span>
                      }
                    </div>
                  </div>
                </div>

                <!-- Action Button -->
                <div class="shrink-0 sm:ml-4">
                  @if (backup.webContentLink) {
                    <a [href]="backup.webContentLink" target="_blank"
                       class="inline-block px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl border transition-all active:scale-95 text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-center w-full sm:w-auto">
                      Download
                    </a>
                  } @else if (isFolder(backup)) {
                    <button (click)="navigateTo(backup.id, backup.name)"
                            class="px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl border transition-all active:scale-95 text-zinc-400 bg-zinc-800 border-zinc-700 hover:text-zinc-100 hover:bg-zinc-700 w-full sm:w-auto">
                      Open Folder
                    </button>
                  } @else {
                    <span class="text-zinc-700 text-[10px] font-black uppercase tracking-widest px-4 hidden sm:inline-block">---</span>
                  }
                </div>

              </div>
            } @empty {
              <div class="p-12 text-center text-[10px] font-black uppercase tracking-widest text-zinc-600">
                This folder is empty.
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: []
})
export class BackupListComponent implements OnInit {
  backups = signal<BackupFile[]>([]);
  isLoading = signal<boolean>(true);
  currentPath = signal<NavigationPath[]>([{ id: null, name: 'Root' }]);

  private http = inject(HttpClient);

  ngOnInit(): void {
    this.loadCurrentFolder();
  }

  navigateTo(folderId: string | null, folderName: string): void {
    const path = this.currentPath();
    const existingIndex = path.findIndex((p) => p.id === folderId);

    if (existingIndex > -1) {
      this.currentPath.set(path.slice(0, existingIndex + 1));
    } else {
      this.currentPath.update((p) => [
        ...p,
        { id: folderId, name: folderName },
      ]);
    }

    this.loadCurrentFolder();
  }

  loadCurrentFolder(): void {
    this.isLoading.set(true);
    const path = this.currentPath();
    const currentFolderId = path[path.length - 1].id;

    this.fetchBackups(currentFolderId).subscribe({
      next: (data) => {
        this.backups.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.isLoading.set(false);
      },
    });
  }

  fetchBackups(folderId: string | null): Observable<BackupFile[]> {
    const auth = getAuth();
    const user = auth.currentUser;

    let params = new HttpParams();
    if (folderId) {
      params = params.set('folderId', folderId);
    }

    if (user) {
      return from(user.getIdToken()).pipe(
        switchMap((token) =>
          this.http.get<BackupFile[]>('/api/backups', {
            headers: { Authorization: `Bearer ${token}` },
            params,
          }),
        ),
        catchError((err) => {
          console.error(err);
          return of([]);
        }),
      );
    }

    return this.http.get<BackupFile[]>('/api/backups', { params }).pipe(
      catchError((err) => {
        console.error(err);
        return of([]);
      }),
    );
  }

  isFolder(file: BackupFile): boolean {
    return file.mimeType === 'application/vnd.google-apps.folder';
  }

  formatSize(bytesStr?: string): string {
    if (!bytesStr) return '-';
    const bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
