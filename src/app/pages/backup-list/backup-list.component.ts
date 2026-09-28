import type {
  AfterViewInit,
  OnInit,
  OnDestroy} from '@angular/core';
import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { LucideDatabase, LucideFolder, LucideFile } from '@lucide/angular';
import type {
  BackupFile} from '../../services/backup/backup.service';
import {
  BackupService
} from '../../services/backup/backup.service';
import { Subject, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { IconComponent } from 'src/app/components/shared/icon/icon.component';
import { LoadingService } from '../../services/loading/loading.service';
import { PageContainerComponent } from '../../components/shared/page-container/page-container.component';
import { PageHeaderComponent } from '../../components/shared/page-header/page-header.component';

export interface NavigationPath {
  readonly id: string | null;
  readonly name: string;
}

@Component({
  selector: 'app-backup-list',
  standalone: true,
  imports: [CommonModule, ScrollingModule, IconComponent, PageContainerComponent, PageHeaderComponent],
  templateUrl: './backup-list.component.html',
  styleUrls: ['./backup-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupListComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly LucideDatabase = LucideDatabase;
  protected readonly LucideFolder = LucideFolder;
  protected readonly LucideFile = LucideFile;

  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly loadingService = inject(LoadingService);
  protected readonly backups = signal<BackupFile[]>([]);
  /** True when the current folder failed to load (distinct from an empty folder). */
  protected readonly loadError = signal(false);
  protected readonly currentPath = signal<NavigationPath[]>([
    { id: null, name: 'Root' },
  ]);

  @ViewChild(CdkVirtualScrollViewport) private readonly viewport?: CdkVirtualScrollViewport;

  private readonly backupService = inject(BackupService);
  private resizeObserver?: ResizeObserver;
  private readonly folderRequests = new Subject<string | null>();

  constructor() {
    // switchMap cancels the previous folder's request, so fast breadcrumb/folder
    // navigation can never let an older response overwrite the current listing.
    this.folderRequests.pipe(
      switchMap(folderId => this.backupService.getBackups(folderId).pipe(
        map(files => ({ files, failed: false })),
        catchError((err: Error) => {
          console.error('Failed to load backups', err);
          return of({ files: [] as BackupFile[], failed: true });
        }),
      )),
      takeUntilDestroyed(),
    ).subscribe(({ files, failed }) => {
      this.backups.set(files);
      this.loadError.set(failed);
    });
  }

  ngOnInit(): void {
    this.loadCurrentFolder();
  }

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.viewport?.checkViewportSize();
    });
    this.resizeObserver.observe(this.hostRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  protected navigateTo(folderId: string | null, folderName: string): void {
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

  private loadCurrentFolder(): void {
    this.folderRequests.next(this.currentPath().at(-1)?.id ?? null);
  }

  protected isFolder(file: BackupFile) {
    return file.mimeType === 'application/vnd.google-apps.folder';
  }

  protected trackByBackupId(_index: number, backup: BackupFile): string {
    return backup.id;
  }

  protected formatSize(bytesStr?: string) {
    if (!bytesStr) {
      return '-';
    }
    const bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes) || bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    // Clamp the unit index so a >= 1 TB backup can't index past the array and
    // render "1.1 undefined".
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}
