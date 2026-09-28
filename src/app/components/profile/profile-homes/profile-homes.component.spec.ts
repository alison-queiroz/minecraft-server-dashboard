import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ProfileHomesComponent } from './profile-homes.component';
import type { HomeRow } from './profile-homes.component';
import type {
  AccountHomes,
  HomeCoordinates,
  HomeVisibilityChange,
  ProfileHome,
} from '../../../services/user-profile/user-profile.models';
import { ProfileHomesService } from '../../../services/user-profile/profile-homes.service';

const STEVE = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const ALEX = 'ec561538-f3fd-461d-aff5-086b22154bce';

const makeHome = (overrides: Partial<ProfileHome> = {}): ProfileHome => ({
  name: 'home', world: 'world', x: 10, y: 64, z: -5, isPublic: false, ...overrides,
});

const makeAccount = (overrides: Partial<AccountHomes> = {}): AccountHomes => ({
  type: 'java', name: 'Steve', uuid: STEVE, homes: [], ...overrides,
});

const makeRow = (overrides: Partial<HomeRow> = {}): HomeRow => {
  const home = makeHome(overrides);
  const uuid = overrides.uuid ?? STEVE;
  return { ...home, uuid, key: `${uuid}/${home.name}` };
};

const makeService = () => ({
  loadOwnHomes: vi.fn<() => Promise<AccountHomes[]>>().mockResolvedValue([]),
  setHomesVisibility: vi.fn<(changes: readonly HomeVisibilityChange[]) => Promise<void>>().mockResolvedValue(undefined),
  createHome: vi.fn<(uuid: string, home: HomeCoordinates) => Promise<void>>().mockResolvedValue(undefined),
  deleteHome: vi.fn<(uuid: string, name: string) => Promise<void>>().mockResolvedValue(undefined),
});

/** Protected surface of the component exercised by these tests. */
interface Internals {
  accounts: (() => AccountHomes[]) & { set(v: AccountHomes[]): void };
  rows: () => HomeRow[];
  groups: () => { uuid: string; label: string | null; homes: HomeRow[] }[];
  loaded: () => boolean;
  actionError: () => string | null;
  addError: () => string | null;
  showAddForm: () => boolean;
  newAccount: (() => string) & { set(v: string): void };
  newName: (() => string) & { set(v: string): void };
  newX: (() => string) & { set(v: string): void };
  newY: (() => string) & { set(v: string): void };
  newZ: (() => string) & { set(v: string): void };
  newWorld: (() => string) & { set(v: string): void };
  newPublic: (() => boolean) & { set(v: boolean): void };
  editingKey: () => string | null;
  editPublic: (() => boolean) & { set(v: boolean): void };
  mapBaseUrl: string;
  toggleAddForm(): void;
  addHome(): Promise<void>;
  startEdit(home: HomeRow): void;
  cancelEdit(): void;
  saveEdit(home: HomeRow): Promise<void>;
  deleteHome(home: HomeRow): Promise<void>;
  setAllVisible(isPublic: boolean): Promise<void>;
  allPublic(): boolean;
  toggleGroup(uuid: string): void;
  isGroupCollapsed(uuid: string): boolean;
  onMapCapture(hash: string): void;
  homeMapHash(home: HomeRow): string;
  homeMapUrl(home: HomeRow): string;
  previewHomeOnMap(home: HomeRow): void;
}

describe('ProfileHomesComponent', () => {
  let fixture: ComponentFixture<ProfileHomesComponent>;
  let component: ProfileHomesComponent;
  let cmp: Internals;
  let service: ReturnType<typeof makeService>;

  const setup = async (accounts: AccountHomes[] = []): Promise<void> => {
    service = makeService();
    service.loadOwnHomes.mockResolvedValue(accounts);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProfileHomesComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProfileHomesService, useValue: service },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileHomesComponent);
    component = fixture.componentInstance;
    cmp = component as unknown as Internals;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('loading', () => {
    it('loads the caller homes from the backend on init', async () => {
      await setup([makeAccount({ homes: [makeHome(), makeHome({ name: 'base' })] })]);
      expect(service.loadOwnHomes).toHaveBeenCalledTimes(1);
      expect(el().querySelectorAll('app-profile-item-card')).toHaveLength(2);
    });

    it('shows the unlinked empty state when no Java account is linked', async () => {
      await setup([]);
      expect(el().querySelector('[data-testid="homes-empty-unlinked"]')).toBeTruthy();
      expect(el().querySelector('[data-testid="homes-add-toggle"]')).toBeNull();
    });

    it('shows the no-homes empty state for a linked account without homes', async () => {
      await setup([makeAccount()]);
      expect(el().querySelector('[data-testid="homes-empty"]')).toBeTruthy();
      expect(el().querySelector('[data-testid="homes-empty-unlinked"]')).toBeNull();
    });

    it('shows an error (not the unlinked hint) when loading fails', async () => {
      service = makeService();
      await setup();
      service.loadOwnHomes.mockRejectedValueOnce(new Error('503'));
      await component.refreshFromServer();
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="homes-error"]')?.textContent).toContain('Failed to load homes');
      expect(el().querySelector('[data-testid="homes-empty-unlinked"]')).toBeNull();
    });

    it('refreshFromServer reloads and replaces the list', async () => {
      await setup([makeAccount({ homes: [makeHome()] })]);
      service.loadOwnHomes.mockResolvedValueOnce([makeAccount({ homes: [makeHome({ name: 'newspot' })] })]);
      await component.refreshFromServer();
      expect(cmp.rows().map(r => r.name)).toEqual(['newspot']);
      expect(cmp.loaded()).toBe(true);
    });
  });

  describe('grouping', () => {
    it('hides the group header when a single account is linked', async () => {
      await setup([makeAccount({ homes: [makeHome()] })]);
      expect(cmp.groups()).toEqual([{ uuid: STEVE, label: null, homes: [makeRow()] }]);
      expect(el().querySelector('app-collapsible-section')).toBeNull();
    });

    it('labels one group per account when several are linked, keyed by uuid', async () => {
      await setup([
        makeAccount({ homes: [makeHome()] }),
        makeAccount({ type: 'admin', name: 'Alex', uuid: ALEX, homes: [makeHome()] }),
      ]);
      expect(cmp.groups().map(g => g.label)).toEqual(['Steve', 'Alex']);
      expect(new Set(cmp.rows().map(r => r.key)).size).toBe(2);
      expect(el().querySelectorAll('app-collapsible-section')).toHaveLength(2);
    });

    it('toggleGroup collapses and expands a group', async () => {
      await setup([
        makeAccount({ homes: [makeHome()] }),
        makeAccount({ name: 'Alex', uuid: ALEX, homes: [makeHome({ name: 'farm' })] }),
      ]);
      cmp.toggleGroup(ALEX);
      fixture.detectChanges();
      expect(cmp.isGroupCollapsed(ALEX)).toBe(true);
      expect(el().querySelectorAll('app-profile-item-card')).toHaveLength(1);
      cmp.toggleGroup(ALEX);
      expect(cmp.isGroupCollapsed(ALEX)).toBe(false);
    });
  });

  describe('visibility', () => {
    it('renders the Public badge only for public homes', async () => {
      await setup([makeAccount({ homes: [makeHome({ isPublic: true }), makeHome({ name: 'base' })] })]);
      expect(el().querySelectorAll('.ui-badge--emerald')).toHaveLength(1);
    });

    it('allPublic() is true only when every home is public', async () => {
      await setup([makeAccount({ homes: [makeHome({ isPublic: true }), makeHome({ name: 'b', isPublic: false })] })]);
      expect(cmp.allPublic()).toBe(false);
      await cmp.setAllVisible(true);
      expect(cmp.allPublic()).toBe(true);
    });

    it('allPublic() is false without homes', async () => {
      await setup([makeAccount()]);
      expect(cmp.allPublic()).toBe(false);
    });

    it('setAllVisible sends one batched change for every home across accounts', async () => {
      await setup([
        makeAccount({ homes: [makeHome()] }),
        makeAccount({ name: 'Alex', uuid: ALEX, homes: [makeHome({ name: 'farm' })] }),
      ]);
      await cmp.setAllVisible(true);
      expect(service.setHomesVisibility).toHaveBeenCalledWith([
        { uuid: STEVE, name: 'home', isPublic: true },
        { uuid: ALEX, name: 'farm', isPublic: true },
      ]);
      expect(cmp.rows().every(r => r.isPublic)).toBe(true);
    });

    it('setAllVisible does nothing without homes', async () => {
      await setup([makeAccount()]);
      await cmp.setAllVisible(true);
      expect(service.setHomesVisibility).not.toHaveBeenCalled();
    });

    it('keeps local state and shows an error when saving visibility fails', async () => {
      await setup([makeAccount({ homes: [makeHome()] })]);
      service.setHomesVisibility.mockRejectedValueOnce(new Error('503'));
      await cmp.setAllVisible(true);
      expect(cmp.rows()[0]?.isPublic).toBe(false);
      expect(cmp.actionError()).toContain('visibility');
    });

    it('saveEdit persists one home visibility and closes the editor', async () => {
      await setup([makeAccount({ homes: [makeHome(), makeHome({ name: 'base' })] })]);
      const [row] = cmp.rows();
      cmp.startEdit(row);
      expect(cmp.editingKey()).toBe(`${STEVE}/home`);
      cmp.editPublic.set(true);
      await cmp.saveEdit(row);
      expect(service.setHomesVisibility).toHaveBeenCalledWith([{ uuid: STEVE, name: 'home', isPublic: true }]);
      expect(cmp.rows().map(r => r.isPublic)).toEqual([true, false]);
      expect(cmp.editingKey()).toBeNull();
    });

    it('saveEdit keeps the editor open when the save fails', async () => {
      await setup([makeAccount({ homes: [makeHome()] })]);
      const [row] = cmp.rows();
      cmp.startEdit(row);
      service.setHomesVisibility.mockRejectedValueOnce(new Error('503'));
      await cmp.saveEdit(row);
      expect(cmp.editingKey()).toBe(row.key);
    });

    it('cancelEdit clears the editor', async () => {
      await setup([makeAccount({ homes: [makeHome()] })]);
      cmp.startEdit(cmp.rows()[0]);
      cmp.cancelEdit();
      expect(cmp.editingKey()).toBeNull();
    });
  });

  describe('deleteHome', () => {
    it('does nothing when confirm() is cancelled', async () => {
      await setup([makeAccount({ homes: [makeHome()] })]);
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await cmp.deleteHome(cmp.rows()[0]);
      expect(service.deleteHome).not.toHaveBeenCalled();
      expect(cmp.rows()).toHaveLength(1);
    });

    it('deletes on the server for the owning account and drops the row', async () => {
      await setup([
        makeAccount({ homes: [makeHome()] }),
        makeAccount({ name: 'Alex', uuid: ALEX, homes: [makeHome()] }),
      ]);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await cmp.deleteHome(makeRow({ uuid: ALEX }));
      expect(service.deleteHome).toHaveBeenCalledWith(ALEX, 'home');
      expect(cmp.rows().map(r => r.uuid)).toEqual([STEVE]);
    });

    it('keeps the row and reports an error when the server delete fails', async () => {
      await setup([makeAccount({ homes: [makeHome()] })]);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      service.deleteHome.mockRejectedValueOnce(new Error('404'));
      await cmp.deleteHome(cmp.rows()[0]);
      expect(cmp.rows()).toHaveLength(1);
      expect(cmp.actionError()).toContain('delete');
    });
  });

  describe('add home', () => {
    const fillForm = (name = 'castle', x = '100', y = '64', z = '200'): void => {
      cmp.newName.set(name);
      cmp.newX.set(x);
      cmp.newY.set(y);
      cmp.newZ.set(z);
    };

    it('toggleAddForm resets the form and preselects the first account', async () => {
      await setup([makeAccount(), makeAccount({ name: 'Alex', uuid: ALEX })]);
      cmp.newName.set('stale');
      cmp.toggleAddForm();
      expect(cmp.showAddForm()).toBe(true);
      expect(cmp.newName()).toBe('');
      expect(cmp.newAccount()).toBe(STEVE);
    });

    it('shows the account picker only when several accounts are linked', async () => {
      await setup([makeAccount()]);
      cmp.toggleAddForm();
      fixture.detectChanges();
      expect(el().querySelector('select[aria-label="Account for the new home"]')).toBeNull();

      await setup([makeAccount(), makeAccount({ name: 'Alex', uuid: ALEX })]);
      cmp.toggleAddForm();
      fixture.detectChanges();
      expect(el().querySelectorAll('select[aria-label="Account for the new home"] option')).toHaveLength(2);
    });

    it('requires a name', async () => {
      await setup([makeAccount()]);
      await cmp.addHome();
      expect(cmp.addError()).toContain('required');
      expect(service.createHome).not.toHaveBeenCalled();
    });

    it.each([['abc'], ['Infinity']])('rejects the non-finite coordinate %s', async (x: string) => {
      await setup([makeAccount()]);
      fillForm('home', x);
      await cmp.addHome();
      expect(cmp.addError()).toContain('numbers');
      expect(service.createHome).not.toHaveBeenCalled();
    });

    it('returns early without any linked account', async () => {
      await setup([]);
      fillForm();
      await cmp.addHome();
      expect(service.createHome).not.toHaveBeenCalled();
    });

    it('creates a private home on the first account and reloads', async () => {
      await setup([makeAccount()]);
      fillForm();
      await cmp.addHome();
      expect(service.createHome).toHaveBeenCalledWith(STEVE, { name: 'castle', x: 100, y: 64, z: 200, world: 'world' });
      expect(service.setHomesVisibility).not.toHaveBeenCalled();
      expect(service.loadOwnHomes).toHaveBeenCalledTimes(2);
      expect(cmp.showAddForm()).toBe(false);
    });

    it('creates the home on the picked account and marks it public when asked', async () => {
      await setup([makeAccount(), makeAccount({ name: 'Alex', uuid: ALEX })]);
      cmp.toggleAddForm();
      cmp.newAccount.set(ALEX);
      cmp.newWorld.set('world_nether');
      cmp.newPublic.set(true);
      fillForm('farm');
      await cmp.addHome();
      expect(service.createHome).toHaveBeenCalledWith(ALEX, { name: 'farm', x: 100, y: 64, z: 200, world: 'world_nether' });
      expect(service.setHomesVisibility).toHaveBeenCalledWith([{ uuid: ALEX, name: 'farm', isPublic: true }]);
    });

    it('reports a create failure and keeps the form open', async () => {
      await setup([makeAccount()]);
      cmp.toggleAddForm();
      fillForm();
      service.createHome.mockRejectedValueOnce(new Error('409'));
      await cmp.addHome();
      expect(cmp.addError()).toContain('Failed');
      expect(cmp.showAddForm()).toBe(true);
      expect(service.loadOwnHomes).toHaveBeenCalledTimes(1);
    });

    it('explains when the home was created but could not be made public', async () => {
      await setup([makeAccount()]);
      cmp.newPublic.set(true);
      fillForm();
      service.setHomesVisibility.mockRejectedValueOnce(new Error('503'));
      service.loadOwnHomes.mockResolvedValueOnce([makeAccount({ homes: [makeHome({ name: 'castle' })] })]);
      await cmp.addHome();
      expect(cmp.actionError()).toContain('could not be shown');
      expect(cmp.rows().map(r => r.name)).toEqual(['castle']);
    });
  });

  describe('map helpers', () => {
    it('onMapCapture parses Nether and End worlds and ignores short hashes', async () => {
      await setup();
      cmp.onMapCapture('#world_nether:10.2:64.4:-8.6:0');
      expect([cmp.newWorld(), cmp.newX(), cmp.newY(), cmp.newZ()]).toEqual(['world_nether', '10', '64', '-9']);
      cmp.onMapCapture('#world_the_end:1:2:3:0');
      expect(cmp.newWorld()).toBe('world_the_end');
      cmp.onMapCapture('world:4:5:6:0');
      expect([cmp.newWorld(), cmp.newX()]).toEqual(['world', '4']);
      cmp.onMapCapture(':::');
      expect([cmp.newWorld(), cmp.newX(), cmp.newY(), cmp.newZ()]).toEqual(['world', '4', '5', '6']);
      cmp.onMapCapture('#too-short');
      expect(cmp.newWorld()).toBe('world');
    });

    it('homeMapHash builds the BlueMap hash', async () => {
      await setup();
      expect(cmp.homeMapHash(makeRow({ x: 10, y: 64, z: -5 }))).toBe('#world:10:66:-5:0:0.36:1.5:0:0:free');
    });

    it('homeMapUrl adds a slash when the base URL has none', async () => {
      await setup();
      Object.defineProperty(component, 'mapBaseUrl', { configurable: true, value: 'https://maps.example.com/base' });
      expect(cmp.homeMapUrl(makeRow({ x: 0, y: 64, z: 0 })).startsWith('https://maps.example.com/base/#world:')).toBe(true);
    });

    it('previewHomeOnMap emits the previewRequested event', async () => {
      await setup();
      const emitted: string[] = [];
      component.previewRequested.subscribe((h: string) => emitted.push(h));
      cmp.previewHomeOnMap(makeRow());
      expect(emitted).toEqual(['#world:10:66:-5:0:0.36:1.5:0:0:free']);
    });
  });
});
