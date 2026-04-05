import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
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

describe('PlayerAdvancementsComponent', () => {
  let fixture: ComponentFixture<PlayerAdvancementsComponent>;
  let advancementsService: MockAdvancementsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerAdvancementsComponent],
      providers: [
        LoadingService,
        { provide: AdvancementsService, useClass: MockAdvancementsService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerAdvancementsComponent);
    advancementsService = TestBed.inject(AdvancementsService) as unknown as MockAdvancementsService;

    fixture.componentRef.setInput('uuid', 'player-1');
    fixture.componentRef.setInput('startOpen', true);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.querySelectorAll('.app-tooltip').forEach((el: Element) => el.remove());
  });

  it('updates the tooltip during the first hover when the description finishes loading', () => {
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
});
