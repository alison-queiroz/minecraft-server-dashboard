import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PlayerDetailComponent } from './player-detail.component';
import { SkinViewerComponent } from '../../shared/skin-viewer/skin-viewer.component';
import { PlayerAdvancementsComponent } from '../player-advancements/player-advancements.component';
import { PlayerService } from '../../../services/player/player.service';
import { Player } from '../../../services/player/player.model';
import type { PublicProfile } from '../../../services/user-profile/user-profile.models';
import { EMPTY_PUBLIC_PROFILE, ProfileHomesService } from '../../../services/user-profile/profile-homes.service';

const STEVE_UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const ALEX_UUID = 'ec561538-f3fd-461d-aff5-086b22154bce';

const makePlayer = (over: Partial<Player> = {}): Player => new Player({
  name: 'Steve', uuid: STEVE_UUID, level: 3, health: 20, dimension: 'Overworld',
  pos: [1, 64, 2], last_seen: '2026-01-01 00:00', skin_url: '', ...over,
});

const PROFILE: PublicProfile = {
  locations: [{ id: 'l1', name: 'Spawn', mapHash: '#world:0:64:0', description: 'Start here' }],
  homes: [{ name: 'base', world: 'world_nether', x: 10.4, y: 70, z: -3 }],
};

describe('PlayerDetailComponent', () => {
  let fixture: ComponentFixture<PlayerDetailComponent>;
  let selectedPlayer: ReturnType<typeof signal<Player | null>>;
  let getPublicProfile: ReturnType<typeof vi.fn>;

  const render = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    selectedPlayer = signal<Player | null>(null);
    getPublicProfile = vi.fn(() => of(PROFILE));
    TestBed.overrideComponent(PlayerDetailComponent, {
      remove: { imports: [SkinViewerComponent, PlayerAdvancementsComponent] },
      add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    await TestBed.configureTestingModule({
      imports: [PlayerDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: PlayerService, useValue: { selectedPlayer, selectedPlayerName: signal<string | null>(null) } },
        { provide: ProfileHomesService, useValue: { getPublicProfile } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PlayerDetailComponent);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows the empty state and requests nothing without a selection', async () => {
    await render();
    expect(el().querySelector('.detail-empty-state')).toBeTruthy();
    expect(getPublicProfile).not.toHaveBeenCalled();
  });

  it('loads the public profile of the selected player with a single request', async () => {
    selectedPlayer.set(makePlayer());
    await render();

    expect(getPublicProfile).toHaveBeenCalledTimes(1);
    expect(getPublicProfile).toHaveBeenCalledWith(STEVE_UUID);
    expect(el().querySelector('[data-testid="detail-locations-header"]')).toBeTruthy();
    expect(el().querySelector('[data-testid="detail-homes-header"]')).toBeTruthy();
  });

  it('lists the public locations and homes once expanded', async () => {
    selectedPlayer.set(makePlayer());
    await render();
    const cmp = fixture.componentInstance as unknown as {
      locationsCollapsed: { set(v: boolean): void };
      homesCollapsed: { set(v: boolean): void };
    };
    cmp.locationsCollapsed.set(false);
    cmp.homesCollapsed.set(false);
    fixture.detectChanges();

    const names = [...el().querySelectorAll('.detail-location-name')].map(n => n.textContent?.trim());
    expect(names).toEqual(['Spawn', 'base']);
    expect(el().textContent).toContain('Nether');
  });

  it('does not refetch when the live player list refreshes the same player', async () => {
    selectedPlayer.set(makePlayer());
    await render();
    selectedPlayer.set(makePlayer({ level: 4 }));
    await render();
    expect(getPublicProfile).toHaveBeenCalledTimes(1);
  });

  it('fetches again when another player is selected', async () => {
    selectedPlayer.set(makePlayer());
    await render();
    selectedPlayer.set(makePlayer({ name: 'Alex', uuid: ALEX_UUID }));
    await render();
    expect(getPublicProfile).toHaveBeenLastCalledWith(ALEX_UUID);
    expect(getPublicProfile).toHaveBeenCalledTimes(2);
  });

  it('hides both sections when nothing is public', async () => {
    getPublicProfile.mockReturnValue(of(EMPTY_PUBLIC_PROFILE));
    selectedPlayer.set(makePlayer());
    await render();
    expect(el().querySelector('[data-testid="detail-locations-header"]')).toBeNull();
    expect(el().querySelector('[data-testid="detail-homes-header"]')).toBeNull();
  });

  it('builds map fragments and world labels for homes', () => {
    const cmp = fixture.componentInstance as unknown as {
      homeFragment(home: PublicProfile['homes'][number]): string;
      homeWorldLabel(world: string): string;
    };
    expect(cmp.homeFragment(PROFILE.homes[0])).toBe('world_nether:10:72:-3:0:0.36:500:0:0:free');
    expect(cmp.homeWorldLabel('world_the_end')).toBe('The End');
    expect(cmp.homeWorldLabel('custom')).toBe('custom');
  });
});
