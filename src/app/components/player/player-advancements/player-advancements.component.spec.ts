import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AdvancementsService } from '../../../services/advancements/advancements.service';
import type { AdvancementsResult } from '../../../services/advancements/advancements.service';
import { LoadingService } from '../../../services/loading/loading.service';
import { PlayerAdvancementsComponent } from './player-advancements.component';

class MockAdvancementsService {
  readonly description$ = new Subject<string>();

  getAdvancements() {
    return of<AdvancementsResult>({
      completed: [
        {
          id: 'story/mine_stone',
          label: 'Stone Age',
          category: 'Story',
        },
      ],
      total: 1,
      by_category: { Story: ['story/mine_stone'] },
    });
  }

  getDescription = jest.fn(() => this.description$.asObservable());
}

class MockAdvancementsServiceEmptyDescription extends MockAdvancementsService {
  override getDescription = jest.fn(() => of(''));
}

class MockAdvancementsServiceError extends MockAdvancementsService {
  override getAdvancements() {
    return throwError(() => new Error('API error'));
  }
}

describe('PlayerAdvancementsComponent', () => {
  let fixture: ComponentFixture<PlayerAdvancementsComponent>;
  let advancementsService: MockAdvancementsService;

  const buildFixture = async (serviceClass = MockAdvancementsService) => {
    await TestBed.configureTestingModule({
      imports: [PlayerAdvancementsComponent],
      providers: [
        LoadingService,
        { provide: AdvancementsService, useClass: serviceClass },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerAdvancementsComponent);
    advancementsService = TestBed.inject(AdvancementsService) as unknown as MockAdvancementsService;
  };

  afterEach(() => {
    document.querySelectorAll('.app-tooltip').forEach((el: Element) => el.remove());
    jest.restoreAllMocks();
  });

  it('updates the tooltip during the first hover when the description finishes loading', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();

    const chip = (fixture.nativeElement as HTMLElement).querySelector('.adv-chip');
    expect(chip).toBeTruthy();

    chip?.dispatchEvent(new MouseEvent('mouseenter'));

    expect(document.querySelector('.app-tooltip')?.textContent).toBe('Stone Age');
    expect(advancementsService.getDescription).toHaveBeenCalledWith('story/mine_stone');

    advancementsService.description$.next('Mine stone with your new pickaxe');
    advancementsService.description$.complete();
    fixture.detectChanges();

    expect(document.querySelector('.app-tooltip')?.textContent).toBe('Mine stone with your new pickaxe');
    expect(chip?.getAttribute('aria-label')).toBe('Mine stone with your new pickaxe');
  });

  // ── toggle() ─────────────────────────────────────────────────────────────

  it('opens the section and fetches advancements when toggle() is called on a collapsed section', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', false);
    fixture.detectChanges();

    const cmp = fixture.componentInstance as unknown as { toggle(): void; collapsed: () => boolean };
    expect(cmp.collapsed()).toBe(true);

    cmp.toggle();
    fixture.detectChanges();

    expect(cmp.collapsed()).toBe(false);
  });

  it('does not re-fetch when toggle() is called on already loaded advancements', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();

    const getSpy = jest.spyOn(advancementsService, 'getAdvancements');
    const cmp = fixture.componentInstance as unknown as { toggle(): void };

    // Open then close then open — second open should NOT fetch again
    cmp.toggle(); // close
    fixture.detectChanges();
    cmp.toggle(); // open again
    fixture.detectChanges();

    expect(getSpy).not.toHaveBeenCalled();
  });

  it('does not fetch when toggle() is called for a Bedrock player', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-bedrock');
    fixture.componentRef.setInput('isBedrock', true);
    fixture.componentRef.setInput('startOpen', false);
    fixture.detectChanges();

    const getSpy = jest.spyOn(advancementsService, 'getAdvancements');
    const cmp = fixture.componentInstance as unknown as { toggle(): void };
    cmp.toggle();
    fixture.detectChanges();

    expect(getSpy).not.toHaveBeenCalled();
  });

  // ── prefetchDescription ───────────────────────────────────────────────────

  it('does not call getDescription again when description is already set', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();

    // Simulate description already populated in the advancement
    const cmp = fixture.componentInstance as unknown as {
      result: { (): AdvancementsResult; update: (fn: (r: AdvancementsResult) => AdvancementsResult) => void };
      prefetchDescription(adv: { id: string; label: string; category: string; description?: string }): void;
    };
    cmp.result.update(r => ({
      ...r,
      completed: r.completed.map(a => ({ ...a, description: 'Already loaded' })),
    }));
    fixture.detectChanges();

    const getSpy = jest.spyOn(advancementsService, 'getDescription');
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.adv-chip');
    chip?.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(getSpy).not.toHaveBeenCalled();
  });

  it('does not call getDescription when id is already loading', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();

    const cmp = fixture.componentInstance as unknown as {
      prefetchDescription(adv: { id: string; label: string; category: string; description?: string }): void;
      loadingDescriptionIds: Set<string>;
    };

    // Pre-add the id to loadingDescriptionIds
    cmp.loadingDescriptionIds.add('story/mine_stone');

    const getSpy = jest.spyOn(advancementsService, 'getDescription');
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.adv-chip');
    chip?.dispatchEvent(new MouseEvent('mouseenter'));

    expect(getSpy).not.toHaveBeenCalled();
  });

  // ── fetch() catchError ────────────────────────────────────────────────────

  it('handles errors from getAdvancements gracefully (catchError returns null)', async () => {
    await buildFixture(MockAdvancementsServiceError);
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();

    // No error thrown, component renders with empty result
    expect(fixture.componentInstance).toBeTruthy();
    const result = (fixture.componentInstance as unknown as {
      result: () => AdvancementsResult;
    }).result();
    expect(result.completed).toEqual([]);
  });

  it('falls back to 0 when initialCount is undefined', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('initialCount', undefined);
    fixture.detectChanges();

    const displayCount = (fixture.componentInstance as unknown as { displayCount: () => number }).displayCount();
    expect(displayCount).toBe(0);
  });

  it('groups multiple advancements under the same category', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();

    const cmp = fixture.componentInstance as unknown as {
      result: { set(v: AdvancementsResult): void };
      byCategory: () => Map<string, { id: string }[]>;
    };
    cmp.result.set({
      completed: [
        { id: 'a', label: 'A', category: 'Story' },
        { id: 'b', label: 'B', category: 'Story' },
      ],
      total: 2,
      by_category: { Story: ['a', 'b'] },
    });

    expect(cmp.byCategory().get('Story')?.length).toBe(2);
  });

  it('keeps existing result unchanged when fetched description is empty', async () => {
    await buildFixture(MockAdvancementsServiceEmptyDescription);
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();

    const before = (fixture.componentInstance as unknown as { result: () => AdvancementsResult }).result();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.adv-chip');
    chip?.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    const after = (fixture.componentInstance as unknown as { result: () => AdvancementsResult }).result();
    expect(after.completed[0]?.description).toBe(before.completed[0]?.description);
  });

  it('updates only the matching advancement description and leaves others unchanged', async () => {
    await buildFixture();
    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();

    const cmp = fixture.componentInstance as unknown as {
      result: { set(v: AdvancementsResult): void; (): AdvancementsResult };
      prefetchDescription(adv: { id: string; label: string; category: string; description?: string }): void;
    };
    cmp.result.set({
      completed: [
        { id: 'story/mine_stone', label: 'Stone Age', category: 'Story' },
        { id: 'story/other', label: 'Other', category: 'Story' },
      ],
      total: 2,
      by_category: { Story: ['story/mine_stone', 'story/other'] },
    });

    cmp.prefetchDescription({ id: 'story/mine_stone', label: 'Stone Age', category: 'Story' });
    advancementsService.description$.next('Mine stone with your new pickaxe');
    advancementsService.description$.complete();
    fixture.detectChanges();

    const completed = cmp.result().completed;
    expect(completed[0]?.description).toBe('Mine stone with your new pickaxe');
    expect(completed[1]?.description).toBeUndefined();
  });
});
