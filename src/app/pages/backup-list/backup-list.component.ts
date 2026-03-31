import {
  AfterViewInit,
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { LucideDatabase, LucideFolder, LucideFile } from '@lucide/angular';
import {
  BackupService,
  BackupFile,
} from '../../services/backup/backup.service';
import { IconComponent } from 'src/app/components/shared/icon/icon.component';

export interface NavigationPath {
  readonly id: string | null;
  readonly name: string;
}

@Component({
  selector: 'app-backup-list',
  standalone: true,
  imports: [CommonModule, ScrollingModule, IconComponent],
  templateUrl: './backup-list.component.html',
  styleUrls: ['./backup-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupListComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly LucideDatabase = LucideDatabase;
  protected readonly LucideFolder = LucideFolder;
  protected readonly LucideFile = LucideFile;

  private readonly hostRef = inject(ElementRef<HTMLElement>);
  protected readonly backups = signal<BackupFile[]>([]);
  protected readonly isLoading = signal<boolean>(true);
  protected readonly currentPath = signal<NavigationPath[]>([
    { id: null, name: 'Root' },
  ]);

  @ViewChild(CdkVirtualScrollViewport) private readonly viewport?: CdkVirtualScrollViewport;

  private readonly backupService = inject(BackupService);
  private resizeObserver?: ResizeObserver;

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
    this.isLoading.set(true);
    const path = this.currentPath();
    const currentFolderId = path[path.length - 1].id;

    this.backupService.getBackups(currentFolderId).subscribe({
      next: (data) => {
        this.backups.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to parse backups', err);
        this.isLoading.set(false);
      },
    });
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
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}
