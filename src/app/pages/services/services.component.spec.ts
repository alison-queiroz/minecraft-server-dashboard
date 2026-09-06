import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ServicesComponent } from './services.component';

describe('ServicesComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServicesComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads and renders catalog entries from assets JSON', async () => {
    const fixture = TestBed.createComponent(ServicesComponent);
    const req = httpMock.expectOne('/api/services-catalog');
    req.flush({
      canEdit: false,
      catalog: {
        updatedAt: '2026-04-21',
        sections: [
          {
            title: 'Public',
            description: 'desc',
            services: [
              { name: 'Terraria', host: 'exvegan.duckdns.org', port: 7777, access: 'public' },
            ],
          },
        ],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Service Directory');
    expect(el.textContent).toContain('Terraria');
    expect(el.textContent).toContain('exvegan.duckdns.org:7777');
  });

  it('shows an error message when the catalog request fails', async () => {
    const fixture = TestBed.createComponent(ServicesComponent);
    const req = httpMock.expectOne('/api/services-catalog');
    req.flush('boom', { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Could not load services catalog');
  });

  it('shows editor controls for editable users and saves updated JSON', async () => {
    const fixture = TestBed.createComponent(ServicesComponent);
    const loadReq = httpMock.expectOne('/api/services-catalog');
    loadReq.flush({
      canEdit: true,
      catalog: {
        updatedAt: '2026-04-21',
        sections: [
          {
            title: 'Public',
            description: 'desc',
            services: [{ name: 'Terraria', host: 'exvegan.duckdns.org', port: 7777, access: 'public' }],
          },
        ],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const editButton = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="services-edit"]');
    expect(editButton).toBeTruthy();
    editButton?.click();
    fixture.detectChanges();

    const textarea = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLTextAreaElement>('.editor-textarea');
    expect(textarea).toBeTruthy();
    if (textarea) {
      textarea.value = JSON.stringify({ updatedAt: '2026-04-22', sections: [] }, null, 2);
      textarea.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();

    const saveButton = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="services-save"]');
    saveButton?.click();

    const saveReq = httpMock.expectOne('/api/services-catalog');
    expect(saveReq.request.method).toBe('PUT');
    expect(saveReq.request.body.updatedAt).toBe('2026-04-22');
    saveReq.flush({ ok: true });

    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Updated: 2026-04-22');
  });
});
