import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ProfileHomesComponent } from './profile-homes.component';
import type { LocalHome } from './profile-homes.component';
import { Player } from '../../../services/player/player.model';

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
  (c as unknown as { homes: { (): LocalHome[]; set(v: LocalHome[]): void } }).homes;

describe('ProfileHomesComponent', () => {
  let fixture: ComponentFixture<ProfileHomesComponent>;
  let component: ProfileHomesComponent;
  let httpMock: HttpTestingController;

  const setup = async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileHomesComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileHomesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  };

  afterEach(() => httpMock.verify());

  it('creates the component', async () => {
    await setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('shows the empty state when there are no homes', async () => {
    await setup();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.homes-empty')).toBeTruthy();
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
    httpMock.expectNone(/.*/);
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
    httpMock.expectNone(/.*/);
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
      httpMock.expectNone(/.*/);
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
      httpMock.expectNone(/.*/);
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
      const submit = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.home-form-submit');
      submit?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      const error = (fixture.nativeElement as HTMLElement).querySelector('.homes-error');
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

      const submit = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.home-form-submit');
      submit?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      const error = (fixture.nativeElement as HTMLElement).querySelector('.homes-error');
      expect(error?.textContent).toContain('numbers');
    });
  });
});
