import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LucideServer } from '@lucide/angular';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { InlineErrorComponent } from '../../components/shared/inline-error/inline-error.component';
import { PageContainerComponent } from '../../components/shared/page-container/page-container.component';

interface ServiceEntry {
  name: string;
  host?: string;
  port?: number;
  protocol?: string;
  access: string;
  runtime?: string;
  location?: string;
  notes?: string;
}

interface ServiceSection {
  title: string;
  description: string;
  services: ServiceEntry[];
}

interface ServicesCatalog {
  updatedAt: string;
  sections: ServiceSection[];
}

interface ServicesCatalogResponse {
  catalog: ServicesCatalog;
  canEdit: boolean;
}

@Component({
  selector: 'app-services',
  standalone: true,
  imports: [IconComponent, InlineErrorComponent, PageContainerComponent],
  templateUrl: './services.component.html',
  styleUrls: ['./services.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicesComponent {
  protected readonly LucideServer = LucideServer;
  private readonly http = inject(HttpClient);

  protected readonly catalog = signal<ServicesCatalog | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly canEdit = signal(false);
  protected readonly editMode = signal(false);
  protected readonly draftJson = signal('');
  protected readonly saveError = signal<string | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    void this.loadCatalog();
  }

  protected endpoint(entry: ServiceEntry): string {
    const host = entry.host;
    const port = entry.port;
    if (!host && !port) {
      return 'Private / request-based';
    }
    if (!host) {
      return `Port ${port}`;
    }
    if (!port) {
      return host;
    }
    return `${host}:${port}`;
  }

  protected startEditing(): void {
    const current = this.catalog();
    if (!current) {
      return;
    }
    this.draftJson.set(JSON.stringify(current, null, 2));
    this.saveError.set(null);
    this.editMode.set(true);
  }

  protected cancelEditing(): void {
    this.editMode.set(false);
    this.saveError.set(null);
  }

  protected updateDraft(value: string): void {
    this.draftJson.set(value);
  }

  protected async saveCatalog(): Promise<void> {
    const draft = this.draftJson();
    let payload: ServicesCatalog;

    try {
      payload = JSON.parse(draft) as ServicesCatalog;
    } catch {
      this.saveError.set('Invalid JSON. Fix syntax and try again.');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);

    try {
      await firstValueFrom(this.http.put<{ ok: boolean }>('/api/services-catalog', payload));
      this.catalog.set(payload);
      this.editMode.set(false);
    } catch {
      this.saveError.set('Failed to save catalog. Ensure your account is configured as an editor.');
    } finally {
      this.saving.set(false);
    }
  }

  private async loadCatalog(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ServicesCatalogResponse>('/api/services-catalog')
      );
      this.catalog.set(response.catalog);
      this.canEdit.set(response.canEdit);
      this.loadError.set(null);
    } catch {
      this.loadError.set('Could not load services catalog. Check API connectivity and server logs.');
      this.catalog.set(null);
      this.canEdit.set(false);
    }
  }
}
