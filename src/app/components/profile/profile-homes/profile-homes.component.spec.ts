import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ProfileHomesComponent } from './profile-homes.component';
import type { LocalHome } from './profile-homes.component';
import { Player } from '../../../services/player/player.model';
import { UserProfileService } from '../../../services/user-profile/user-profile.service';
import { environment } from '../../../../environments/environment';

const mockUserProfileService = {
  savedHomes: signal<{ name: string; world: string; x: number; y: number; z: number; isPublic: boolean }[]>([]),
  upsertHomesFromLocal: () => Promise.resolve(),
  deleteHomeByName: () => Promise.resolve(),
};

const makeLocalHome = (overrides: Partial<LocalHome> = {}): LocalHome => ({
  id: 'home',
  name: 'home',
  x: 10,
  y: 64,
  z: -5,
  world: 'world',
  isPublic: false,
  ...overrides,
});

const makePlayer = (): Player =>
  new Player({
    name: 'Steve',
    uuid: 'aaaa-1111',
    level: 1,
    health: 20,
    dimension: 'Overworld',
    pos: [0, 64, 0],
    last_seen: '2026-01-01 00:00',
    skin_url: 'http://skin',
    homes: [],
  });

/** Drain the microtask queue so async chains complete after HTTP flush. */
const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Access the protected `homes` signal for test setup and assertions. */
const getHomes = (c: ProfileHomesComponent) =>
  (c as unknown as { homes: (() => LocalHome[]) & { set(v: LocalHome[]): void } }).homes;

describe('ProfileHomesComponent', () => {
  let fixture: ComponentFixture<ProfileHomesComponent>;
  let component: ProfileHomesComponent;
  let httpMock: HttpTestingController;

  const setup = async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProfileHomesComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UserProfileService, useValue: mockUserProfileService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileHomesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  };

  afterEach(() => {
    mockUserProfileService.savedHomes.set([]);
    httpMock?.verify();
    TestBed.resetTestingModule();
  });

  it('creates the component', async () => {
    await setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('uses the default map base URL when the environment value is missing', async () => {
    const original = environment.mapBaseUrl;
    (environment as { mapBaseUrl?: string }).mapBaseUrl = undefined;

    try {
      await setup();
      fixture.detectChanges();
      expect((component as unknown as { mapBaseUrl: string }).mapBaseUrl)
        .toBe('https://exvegan-minecraft-map.duckdns.org/');
    } finally {
      (environment as { mapBaseUrl?: string }).mapBaseUrl = original;
    }
  });

  it('shows the empty state when there are no homes', async () => {
    await setup();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid^="homes-empty"]')).toBeTruthy();
  });

  it('renders a home card for each home', async () => {
    await setup();
    getHomes(component).set([
      makeLocalHome({ id: 'home', name: 'home' }),
      makeLocalHome({ id: 'base', name: 'base' }),
    ]);
    fixture.detectChanges();
    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('app-profile-item-card');
    expect(cards.length).toBe(2);
  });

  it('shows the Public badge when isPublic is true', async () => {
    await setup();
    getHomes(component).set([makeLocalHome({ isPublic: true })]);
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('.item-badge');
    expect(badge).toBeTruthy();
  });

  it('hides the Public badge when isPublic is false', async () => {
    await setup();
    getHomes(component).set([makeLocalHome({ isPublic: false })]);
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('.item-badge');
    expect(badge).toBeNull();
  });

  it('allPublic() returns true only when every home is public', async () => {
    await setup();
    getHomes(component).set([
      makeLocalHome({ isPublic: true }),
      makeLocalHome({ id: 'base', name: 'base', isPublic: true }),
    ]);
    fixture.detectChanges();
    expect((component as unknown as { allPublic: () => boolean }).allPublic()).toBe(true);
  });

  it('allPublic() returns false when at least one home is private', async () => {
    await setup();
    getHomes(component).set([
      makeLocalHome({ isPublic: true }),
      makeLocalHome({ id: 'base', name: 'base', isPublic: false }),
    ]);
    fixture.detectChanges();
    expect((component as unknown as { allPublic: () => boolean }).allPublic()).toBe(false);
  });

  it('setAllVisible(true) marks all homes public without API requests', async () => {
    await setup();
    getHomes(component).set([makeLocalHome(), makeLocalHome({ id: 'base', name: 'base' })]);
    fixture.detectChanges();
    (component as unknown as { setAllVisible: (v: boolean) => void }).setAllVisible(true);
    fixture.detectChanges();
    expect(getHomes(component)().every(h => h.isPublic)).toBe(true);
    httpMock.expectNone(() => true);
  });

  it('setAllVisible(false) marks all homes private without API requests', async () => {
    await setup();
    getHomes(component).set([
      makeLocalHome({ isPublic: true }),
      makeLocalHome({ id: 'base', name: 'base', isPublic: true }),
    ]);
    fixture.detectChanges();
    (component as unknown as { setAllVisible: (v: boolean) => void }).setAllVisible(false);
    fixture.detectChanges();
    expect(getHomes(component)().every(h => !h.isPublic)).toBe(true);
    httpMock.expectNone(() => true);
  });

  describe('load from server', () => {
    it('fetches homes from the API when players input is set', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();

      const req = httpMock.expectOne(`/api/players/${player.uuid}/homes`);
      req.flush([{ name: 'casa', world: 'world', x: -122, y: 102, z: 41 }]);
      await flushMicrotasks();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getHomes(component)()).toHaveLength(1);
      expect(getHomes(component)()[0].name).toBe('casa');
    });

    it('does nothing when players list is empty', async () => {
      await setup();
      fixture.componentRef.setInput('players', []);
      fixture.detectChanges();
      httpMock.expectNone(() => true);
    });

    it('skips Bedrock players (no API request for them)', async () => {
      await setup();
      const bedrock = new Player({
        name: '.BedrockPlayer',
        uuid: '00000000-0000-0000-0009-aaaaaaaaaaaa',
        level: 1, health: 20, dimension: 'Overworld',
        pos: [0, 64, 0], last_seen: '2026-01-01', skin_url: '', homes: [],
      });
      fixture.componentRef.setInput('players', [bedrock]);
      fixture.detectChanges();
      httpMock.expectNone(() => true);
    });
  });

  describe('refreshFromServer', () => {
    it('re-fetches homes from API and updates the signal', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();
      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([]);
      await flushMicrotasks();
      await fixture.whenStable();

      const c = component as unknown as { refreshFromServer: () => Promise<void> };
      void c.refreshFromServer();

      const req = httpMock.expectOne(`/api/players/${player.uuid}/homes`);
      req.flush([{ name: 'newspot', world: 'world_nether', x: 50, y: 60, z: 70 }]);
      await flushMicrotasks();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getHomes(component)()).toHaveLength(1);
      expect(getHomes(component)()[0].name).toBe('newspot');
    });

    it('syncFromServer re-fetches homes from API and updates the signal', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();
      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([]);
      await flushMicrotasks();
      await fixture.whenStable();

      const c = component as unknown as { syncFromServer(): Promise<void> };
      void c.syncFromServer();

      const req = httpMock.expectOne(`/api/players/${player.uuid}/homes`);
      req.flush([{ name: 'sync-spot', world: 'world', x: 10, y: 64, z: 20 }]);
      await flushMicrotasks();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getHomes(component)().some(h => h.name === 'sync-spot')).toBe(true);
    });
  });

  describe('deleteHome', () => {
    it('calls DELETE on the API and removes the home from the signal', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();
      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([]);
      await flushMicrotasks();

      getHomes(component).set([makeLocalHome()]);
      fixture.detectChanges();

      jest.spyOn(window, 'confirm').mockReturnValue(true);
      const c = component as unknown as { deleteHome: (h: LocalHome) => Promise<void> };
      void c.deleteHome(makeLocalHome());

      httpMock.expectOne(`/api/players/${player.uuid}/homes/home`).flush({ ok: true });
      await flushMicrotasks();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getHomes(component)()).toHaveLength(0);
    });

    it('does not remove from signal when DELETE fails', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();
      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([]);
      await flushMicrotasks();

      getHomes(component).set([makeLocalHome()]);
      fixture.detectChanges();

      jest.spyOn(window, 'confirm').mockReturnValue(true);
      const c = component as unknown as { deleteHome: (h: LocalHome) => Promise<void> };
      void c.deleteHome(makeLocalHome());

      httpMock.expectOne(`/api/players/${player.uuid}/homes/home`)
        .flush('Not found', { status: 404, statusText: 'Not Found' });
      await flushMicrotasks();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getHomes(component)()).toHaveLength(1);
    });
  });

  describe('add form validation', () => {
    const openAddForm = () => {
      const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.homes-toggle');
      btn?.click();
      fixture.detectChanges();
    };

    it('shows an error when name is empty', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();
      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([]);
      await flushMicrotasks();
      fixture.detectChanges();

      openAddForm();
      const submit = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.home-form-submit button');
      submit?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      const error = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
      expect(error?.textContent).toContain('required');
    });

    it('shows an error when coordinates are not numbers', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();
      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([]);
      await flushMicrotasks();
      fixture.detectChanges();

      openAddForm();
      const nameInput = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[placeholder*="Home name"]');
      if (nameInput) { nameInput.value = 'myHome'; nameInput.dispatchEvent(new Event('input')); }

      const xInput = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="number"]')[0];
      if (xInput) { xInput.value = 'abc'; xInput.dispatchEvent(new Event('input')); }

      const submit = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.home-form-submit button');
      submit?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      const error = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
      expect(error?.textContent).toContain('numbers');
    });
  });

  // ── toggleGroup / isGroupCollapsed ────────────────────────────────────────

  describe('grouping helpers', () => {
    it('groupedHomes returns a single null-header group when one Java player is linked', async () => {
      await setup();
      fixture.componentRef.setInput('players', [makePlayer()]);
      fixture.detectChanges();
      httpMock.expectOne('/api/players/aaaa-1111/homes').flush([]);
      await flushMicrotasks();
      getHomes(component).set([makeLocalHome({ name: 'home' })]);
      fixture.detectChanges();

      const groups = (component as unknown as {
        groupedHomes: () => { playerName: string | null; homes: LocalHome[] }[];
      }).groupedHomes();

      expect(groups).toEqual([{ playerName: null, homes: [makeLocalHome({ name: 'home' })] }]);
    });

    it('groupedHomes creates per-player groups and an Other bucket for unprefixed homes', async () => {
      await setup();
      const alex = new Player({
        name: 'Alex', uuid: 'bbbb-2222', level: 1, health: 20, dimension: 'Overworld',
        pos: [0, 64, 0], last_seen: '2026-01-01 00:00', skin_url: 'http://skin', homes: [],
      });
      fixture.componentRef.setInput('players', [makePlayer(), alex]);
      fixture.detectChanges();
      httpMock.expectOne('/api/players/aaaa-1111/homes').flush([]);
      await flushMicrotasks();
      httpMock.expectOne('/api/players/bbbb-2222/homes').flush([]);
      await flushMicrotasks();
      getHomes(component).set([
        makeLocalHome({ id: '1', name: 'Steve:home' }),
        makeLocalHome({ id: '2', name: 'Alex:base' }),
        makeLocalHome({ id: '3', name: 'spawn' }),
      ]);
      fixture.detectChanges();

      const groups = (component as unknown as {
        groupedHomes: () => { playerName: string | null; homes: LocalHome[] }[];
      }).groupedHomes();

      expect(groups.some(g => g.playerName === 'Steve' && g.homes.length === 1)).toBe(true);
      expect(groups.some(g => g.playerName === 'Alex' && g.homes.length === 1)).toBe(true);
      expect(groups.some(g => g.playerName === 'Other' && g.homes[0]?.name === 'spawn')).toBe(true);
    });

    it('homeDisplayName strips the player prefix when present and leaves bare names unchanged', async () => {
      await setup();
      const cmp = component as unknown as { homeDisplayName(name: string): string };
      expect(cmp.homeDisplayName('Steve:home')).toBe('home');
      expect(cmp.homeDisplayName('spawn')).toBe('spawn');
    });
  });

  describe('toggleGroup / isGroupCollapsed', () => {
    it('toggleGroup adds a playerName to collapsedGroups and isGroupCollapsed returns true', async () => {
      await setup();
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        toggleGroup(name: string): void;
        isGroupCollapsed(name: string): boolean;
      };

      expect(cmp.isGroupCollapsed('Steve')).toBe(false);
      cmp.toggleGroup('Steve');
      expect(cmp.isGroupCollapsed('Steve')).toBe(true);
    });

    it('toggleGroup removes a playerName when called again', async () => {
      await setup();
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        toggleGroup(name: string): void;
        isGroupCollapsed(name: string): boolean;
      };

      cmp.toggleGroup('Steve');
      expect(cmp.isGroupCollapsed('Steve')).toBe(true);
      cmp.toggleGroup('Steve');
      expect(cmp.isGroupCollapsed('Steve')).toBe(false);
    });
  });

  // ── saveEdit ──────────────────────────────────────────────────────────────

  describe('saveEdit', () => {
    it('updates isPublic and calls upsertHomesFromLocal', async () => {
      await setup();
      fixture.detectChanges();

      const home = makeLocalHome({ id: 'home', isPublic: false });
      getHomes(component).set([home]);
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        saveEdit(id: string): Promise<void>;
        editPublic: { set(v: boolean): void; (): boolean };
        editingId: () => string | null;
      };

      const upsertSpy = jest.spyOn(mockUserProfileService, 'upsertHomesFromLocal');
      cmp.editPublic.set(true);
      await cmp.saveEdit('home');

      expect(getHomes(component)()[0].isPublic).toBe(true);
      expect(upsertSpy).toHaveBeenCalled();
      expect(cmp.editingId()).toBeNull();
    });

    it('leaves non-matching homes unchanged while saving the edited one', async () => {
      await setup();
      fixture.detectChanges();
      getHomes(component).set([
        makeLocalHome({ id: 'home', isPublic: false }),
        makeLocalHome({ id: 'base', name: 'base', isPublic: false }),
      ]);

      const cmp = fixture.componentInstance as unknown as {
        saveEdit(id: string): Promise<void>;
        editPublic: { set(v: boolean): void };
      };
      cmp.editPublic.set(true);
      await cmp.saveEdit('home');

      const all = getHomes(component)();
      expect(all.find(h => h.id === 'home')?.isPublic).toBe(true);
      expect(all.find(h => h.id === 'base')?.isPublic).toBe(false);
    });
  });

  // ── cancelEdit ────────────────────────────────────────────────────────────

  describe('cancelEdit', () => {
    it('clears editingId when cancelEdit is called', async () => {
      await setup();
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        startEdit(h: LocalHome): void;
        cancelEdit(): void;
        editingId: () => string | null;
      };

      cmp.startEdit(makeLocalHome());
      expect(cmp.editingId()).toBeTruthy();

      cmp.cancelEdit();
      expect(cmp.editingId()).toBeNull();
    });
  });

  // ── homeMapHash / homeMapUrl / previewHomeOnMap ───────────────────────────

  describe('homeMapHash, homeMapUrl, previewHomeOnMap', () => {
    it('homeMapUrl adds a slash when mapBaseUrl has no trailing slash', async () => {
      await setup();
      fixture.detectChanges();
      Object.defineProperty(component, 'mapBaseUrl', {
        configurable: true,
        value: 'https://maps.example.com/base',
      });

      const cmp = fixture.componentInstance as unknown as {
        homeMapUrl(h: LocalHome): string;
      };
      const url = cmp.homeMapUrl(makeLocalHome({ x: 0, y: 64, z: 0, world: 'world' }));
      expect(url.startsWith('https://maps.example.com/base/#world:')).toBe(true);
    });
    it('homeMapHash builds correct BlueMap hash', async () => {
      await setup();
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        homeMapHash(h: LocalHome): string;
      };

      const hash = cmp.homeMapHash(makeLocalHome({ x: 10, y: 64, z: -5, world: 'world' }));
      expect(hash).toBe('#world:10:66:-5:0:0.36:1.5:0:0:free');
    });

    it('homeMapUrl prepends the base URL', async () => {
      await setup();
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        homeMapUrl(h: LocalHome): string;
      };

      const url = cmp.homeMapUrl(makeLocalHome({ x: 0, y: 64, z: 0, world: 'world' }));
      expect(url).toContain('#world:');
    });

    it('previewHomeOnMap emits the previewRequested event', async () => {
      await setup();
      fixture.detectChanges();

      const emittedHashes: string[] = [];
      component.previewRequested.subscribe((h: string) => emittedHashes.push(h));

      const cmp = fixture.componentInstance as unknown as {
        previewHomeOnMap(h: LocalHome): void;
      };
      cmp.previewHomeOnMap(makeLocalHome({ x: 10, y: 64, z: -5, world: 'world' }));

      expect(emittedHashes.length).toBe(1);
      expect(emittedHashes[0]).toContain('#world:');
    });
  });

  // ── addHome success path ──────────────────────────────────────────────────

  describe('load and capture helpers', () => {
    it('prefers previous local isPublic over Firestore during reload', async () => {
      await setup();
      const player = makePlayer();
      getHomes(component).set([makeLocalHome({ id: 'home', name: 'home', isPublic: true })]);
      mockUserProfileService.savedHomes.set([{ name: 'home', world: 'world', x: 1, y: 2, z: 3, isPublic: false }]);
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();

      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([{ name: 'home', world: 'world', x: 1, y: 2, z: 3 }]);
      await flushMicrotasks();
      await fixture.whenStable();

      expect(getHomes(component)()[0]?.isPublic).toBe(true);
    });

    it('uses Firestore isPublic when there is no previous local match', async () => {
      await setup();
      const player = makePlayer();
      mockUserProfileService.savedHomes.set([{ name: 'home', world: 'world', x: 1, y: 2, z: 3, isPublic: true }]);
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();

      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([{ name: 'home', world: 'world', x: 1, y: 2, z: 3 }]);
      await flushMicrotasks();
      await fixture.whenStable();

      expect(getHomes(component)()[0]?.isPublic).toBe(true);
    });

    it('falls back to false when a previous local home exists with an undefined visibility flag', async () => {
      await setup();
      const player = makePlayer();
      getHomes(component).set([{ ...makeLocalHome({ id: 'home', name: 'home' }), isPublic: undefined as never }]);
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();

      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([{ name: 'home', world: 'world', x: 1, y: 2, z: 3 }]);
      await flushMicrotasks();
      await fixture.whenStable();

      expect(getHomes(component)()[0]?.isPublic).toBe(false);
    });

    it('fetchServerHomes returns [] when the API request fails', async () => {
      await setup();
      const cmp = component as unknown as { fetchServerHomes(uuid: string): Promise<unknown[]> };
      const http = TestBed.inject(HttpTestingController);
      const promise = cmp.fetchServerHomes('aaaa-1111');
      http.expectOne('/api/players/aaaa-1111/homes').flush('boom', { status: 500, statusText: 'Server Error' });
      await expect(promise).resolves.toEqual([]);
    });

    it('onMapCapture parses Nether and End worlds and ignores short hashes', async () => {
      await setup();
      const cmp = component as unknown as {
        onMapCapture(hash: string): void;
        newWorld: () => string;
        newX: () => string;
        newY: () => string;
        newZ: () => string;
      };

      cmp.onMapCapture('#world_nether:10.2:64.4:-8.6:0');
      expect(cmp.newWorld()).toBe('world_nether');
      expect(cmp.newX()).toBe('10');
      expect(cmp.newY()).toBe('64');
      expect(cmp.newZ()).toBe('-9');

      cmp.onMapCapture('#world_the_end:1:2:3:0');
      expect(cmp.newWorld()).toBe('world_the_end');

      cmp.onMapCapture('world:4:5:6:0');
      expect(cmp.newWorld()).toBe('world');
      expect(cmp.newX()).toBe('4');

      cmp.onMapCapture(':::');
      expect(cmp.newWorld()).toBe('world');
      expect(cmp.newX()).toBe('4');
      expect(cmp.newY()).toBe('5');
      expect(cmp.newZ()).toBe('6');

      cmp.onMapCapture('#too-short');
      expect(cmp.newWorld()).toBe('world');
    });

    it('resolves server target for no players, single player, unknown owner, and multi-account owner', async () => {
      await setup();
      const alex = new Player({
        name: 'Alex', uuid: 'bbbb-2222', level: 1, health: 20, dimension: 'Overworld',
        pos: [0, 64, 0], last_seen: '2026-01-01 00:00', skin_url: 'http://skin', homes: [],
      });
      const cmp = component as unknown as {
        _resolveServerTarget(name: string): { uuid: string; serverName: string } | null;
      };

      fixture.componentRef.setInput('players', []);
      fixture.detectChanges();
      expect(cmp._resolveServerTarget('home')).toBeNull();

      fixture.componentRef.setInput('players', [makePlayer()]);
      fixture.detectChanges();
      expect(cmp._resolveServerTarget('home')).toEqual({ uuid: 'aaaa-1111', serverName: 'home' });
      httpMock.expectOne('/api/players/aaaa-1111/homes').flush([]);
      await flushMicrotasks();

      fixture.componentRef.setInput('players', [makePlayer(), alex]);
      fixture.detectChanges();
      expect(cmp._resolveServerTarget('Unknown:home')).toBeNull();
      expect(cmp._resolveServerTarget('Alex:base')).toEqual({ uuid: 'bbbb-2222', serverName: 'base' });
      httpMock.expectOne('/api/players/aaaa-1111/homes').flush([]);
      await flushMicrotasks();
      httpMock.expectOne('/api/players/bbbb-2222/homes').flush([]);
      await flushMicrotasks();

    });

    it('returns null when a single filtered Java player slot is unexpectedly empty', async () => {
      await setup();
      const cmp = component as unknown as {
        _resolveServerTarget(name: string): { uuid: string; serverName: string } | null;
      };
      (component as unknown as { players: () => { filter: () => unknown[] } }).players = () => ({
        filter: () => [undefined],
      });

      expect(cmp._resolveServerTarget('home')).toBeNull();
    });
  });

  describe('addHome success', () => {
    it('adds the new home to the list after a successful API POST', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();
      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([]);
      await flushMicrotasks();
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        addHome(): Promise<void>;
        newName: { set(v: string): void };
        newX: { set(v: string): void };
        newY: { set(v: string): void };
        newZ: { set(v: string): void };
      };

      cmp.newName.set('castle');
      cmp.newX.set('100');
      cmp.newY.set('64');
      cmp.newZ.set('200');

      const addPromise = cmp.addHome();

      const req = httpMock.expectOne(`/api/players/${player.uuid}/homes`);
      expect(req.request.method).toBe('POST');
      req.flush({ ok: true });

      await addPromise;
      await flushMicrotasks();
      fixture.detectChanges();

      expect(getHomes(component)().some(h => h.name === 'castle')).toBe(true);
    });

    it('sets addError when the API POST fails', async () => {
      await setup();
      const player = makePlayer();
      fixture.componentRef.setInput('players', [player]);
      fixture.detectChanges();
      httpMock.expectOne(`/api/players/${player.uuid}/homes`).flush([]);
      await flushMicrotasks();
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        addHome(): Promise<void>;
        newName: { set(v: string): void };
        newX: { set(v: string): void };
        newY: { set(v: string): void };
        newZ: { set(v: string): void };
        addError: () => string | null;
      };

      cmp.newName.set('failhome');
      cmp.newX.set('0');
      cmp.newY.set('64');
      cmp.newZ.set('0');

      const addPromise = cmp.addHome();

      const req = httpMock.expectOne(`/api/players/${player.uuid}/homes`);
      req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });

      await addPromise.catch(() => undefined);
      await flushMicrotasks();
      fixture.detectChanges();

      expect(cmp.addError()).toContain('Failed');
    });

    it('returns early when there are no Java players to add a home to', async () => {
      await setup();
      const bedrock = new Player({
        name: '.BedrockPlayer', uuid: '00000000-0000-0000-0009-aaaaaaaaaaaa', level: 1, health: 20,
        dimension: 'Overworld', pos: [0, 64, 0], last_seen: '2026-01-01', skin_url: '', homes: [],
      });
      fixture.componentRef.setInput('players', [bedrock]);
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as { addHome(): Promise<void> };
      await cmp.addHome();
      httpMock.expectNone(req => /\/api\/players\/.*\/homes/.test(req.url));
    });

    it('returns early when the filtered Java player list has no usable first entry', async () => {
      await setup();
      const cmp = fixture.componentInstance as unknown as {
        addHome(): Promise<void>;
        newName: { set(v: string): void };
        newX: { set(v: string): void };
        newY: { set(v: string): void };
        newZ: { set(v: string): void };
      };
      // Set valid form values so addHome passes the name/number validations
      cmp.newName.set('basecamp');
      cmp.newX.set('10');
      cmp.newY.set('64');
      cmp.newZ.set('20');
      // Override players() so destructuring gives undefined as first element (line 243 guard)
      (component as unknown as { players: () => { filter: () => unknown[] } }).players = () => ({
        filter: () => [undefined],
      });

      await cmp.addHome();
      httpMock.expectNone(req => /\/api\/players\/.*\/homes/.test(req.url));
    });

    it('prefixes the stored home name when multiple Java players are linked', async () => {
      await setup();
      const alex = new Player({
        name: 'Alex', uuid: 'bbbb-2222', level: 1, health: 20, dimension: 'Overworld',
        pos: [0, 64, 0], last_seen: '2026-01-01 00:00', skin_url: 'http://skin', homes: [],
      });
      fixture.componentRef.setInput('players', [makePlayer(), alex]);
      fixture.detectChanges();
      httpMock.expectOne('/api/players/aaaa-1111/homes').flush([]);
      await flushMicrotasks();
      httpMock.expectOne('/api/players/bbbb-2222/homes').flush([]);
      await flushMicrotasks();
      fixture.detectChanges();

      const cmp = fixture.componentInstance as unknown as {
        addHome(): Promise<void>;
        newName: { set(v: string): void };
        newX: { set(v: string): void };
        newY: { set(v: string): void };
        newZ: { set(v: string): void };
      };
      cmp.newName.set('castle');
      cmp.newX.set('1');
      cmp.newY.set('2');
      cmp.newZ.set('3');

      const addPromise = cmp.addHome();
      httpMock.expectOne('/api/players/aaaa-1111/homes').flush({ ok: true });
      await addPromise;
      await flushMicrotasks();

      expect(getHomes(component)().some(h => h.name === 'Steve:castle')).toBe(true);
    });
  });

  describe('deleteHome edge cases', () => {
    it('returns early when confirm() is cancelled', async () => {
      await setup();
      getHomes(component).set([makeLocalHome()]);
      fixture.detectChanges();
      jest.spyOn(window, 'confirm').mockReturnValue(false);

      const cmp = component as unknown as { deleteHome(home: LocalHome): Promise<void> };
      await cmp.deleteHome(makeLocalHome());
      expect(getHomes(component)()).toHaveLength(1);
    });

    it('removes the home locally when no Java owner can be resolved', async () => {
      await setup();
      const bedrock = new Player({
        name: '.BedrockPlayer', uuid: '00000000-0000-0000-0009-aaaaaaaaaaaa', level: 1, health: 20,
        dimension: 'Overworld', pos: [0, 64, 0], last_seen: '2026-01-01', skin_url: '', homes: [],
      });
      fixture.componentRef.setInput('players', [bedrock]);
      fixture.detectChanges();
      getHomes(component).set([makeLocalHome()]);
      fixture.detectChanges();
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      const deleteSpy = jest.spyOn(mockUserProfileService, 'deleteHomeByName');

      const cmp = component as unknown as { deleteHome(home: LocalHome): Promise<void> };
      await cmp.deleteHome(makeLocalHome());

      expect(getHomes(component)()).toHaveLength(0);
      expect(deleteSpy).toHaveBeenCalledWith('home');
      httpMock.expectNone(req => /\/api\/players\/.*\/homes/.test(req.url));
    });
  });
});
