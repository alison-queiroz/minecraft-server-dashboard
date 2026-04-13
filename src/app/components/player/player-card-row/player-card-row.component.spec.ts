import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { PlayerCardRowComponent } from './player-card-row.component';
import { PlayerService } from '../../../services/player/player.service';
import { Player } from '../../../services/player/player.model';

class MockPlayerService {
  fetchAvatarIfNeeded(_url: string): void { return; }
  getAvatarUrl(url: string): string { return url; }
}

describe('PlayerCardRowComponent', () => {
  let fixture: ComponentFixture<PlayerCardRowComponent>;
  const player = new Player({
    name: 'Steve',
    uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
    level: 20,
    health: 18,
    dimension: 'Overworld',
    pos: [0, 64, 0],
    last_seen: 'now',
    skin_url: 'https://textures.minecraft.net/texture/raw',
    advancement_count: 42,
    play_hours: 10,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerCardRowComponent],
      providers: [
        { provide: PlayerService, useClass: MockPlayerService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerCardRowComponent);
    fixture.componentRef.setInput('player', player);
    fixture.detectChanges();
  });

  it('emits selected when row is clicked', () => {
    jest.spyOn(fixture.componentInstance.selected, 'emit');

    (fixture.nativeElement as HTMLElement).click();

    expect(fixture.componentInstance.selected.emit).toHaveBeenCalledTimes(1);
  });

  describe('IntersectionObserver for mc-heads players', () => {
    const mcHeadsPlayer = new Player({
      name: 'Alex',
      uuid: 'bbbbbbbb-0000-0000-0000-000000000002',
      level: 5,
      health: 20,
      dimension: 'Overworld',
      pos: [0, 64, 0],
      last_seen: 'now',
      skin_url: 'https://mc-heads.net/skin/Alex',
      is_raw_skin: false,
    });

    function makeMockObserver(observeSpy: ReturnType<typeof jest.fn>, disconnectSpy: ReturnType<typeof jest.fn>) {
      return class MockIO {
        constructor() { /* callback ignored */ }
        observe = observeSpy;
        disconnect = disconnectSpy;
      };
    }

    function makeMockObserverWithCallback(disconnectSpy: ReturnType<typeof jest.fn>) {
      let cb: ((entries: Partial<IntersectionObserverEntry>[]) => void) | undefined;
      const MockIO = class {
        constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
          cb = callback;
        }
        observe = jest.fn();
        disconnect = disconnectSpy;
      };
      return { MockIO, getCallback: () => cb };
    }

    afterEach(() => {
      delete (globalThis as unknown as Record<string, unknown>).IntersectionObserver;
    });

    it('sets up IntersectionObserver for non-raw-avatar player', () => {
      const observeSpy = jest.fn();
      (globalThis as unknown as Record<string, unknown>).IntersectionObserver = makeMockObserver(observeSpy, jest.fn());

      const f = TestBed.createComponent(PlayerCardRowComponent);
      f.componentRef.setInput('player', mcHeadsPlayer);
      f.detectChanges();

      expect(observeSpy).toHaveBeenCalled();
    });

    it('calls fetchAvatarIfNeeded when the element intersects', () => {
      const fetchSpy = jest.spyOn(TestBed.inject(PlayerService), 'fetchAvatarIfNeeded').mockImplementation(() => undefined);
      const { MockIO, getCallback } = makeMockObserverWithCallback(jest.fn());
      (globalThis as unknown as Record<string, unknown>).IntersectionObserver = MockIO;

      const f = TestBed.createComponent(PlayerCardRowComponent);
      f.componentRef.setInput('player', mcHeadsPlayer);
      f.detectChanges();

      getCallback()?.([{ isIntersecting: true }]);

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('does not call fetchAvatarIfNeeded when entry is not intersecting', () => {
      const fetchSpy = jest.spyOn(TestBed.inject(PlayerService), 'fetchAvatarIfNeeded').mockImplementation(() => undefined);
      const { MockIO, getCallback } = makeMockObserverWithCallback(jest.fn());
      (globalThis as unknown as Record<string, unknown>).IntersectionObserver = MockIO;

      const f = TestBed.createComponent(PlayerCardRowComponent);
      f.componentRef.setInput('player', mcHeadsPlayer);
      f.detectChanges();

      getCallback()?.([{ isIntersecting: false }]);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('disconnects observer on component destroy', () => {
      const disconnectSpy = jest.fn();
      (globalThis as unknown as Record<string, unknown>).IntersectionObserver = makeMockObserver(jest.fn(), disconnectSpy);

      const f = TestBed.createComponent(PlayerCardRowComponent);
      f.componentRef.setInput('player', mcHeadsPlayer);
      f.detectChanges();
      f.destroy();

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });
});



