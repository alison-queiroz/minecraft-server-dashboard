/**
 * Covers the Firestore real-time path (listener lifecycle + snapshot ingest)
 * that the main spec bypasses via the PlayerServiceHarness override.
 */
import { TestBed } from '@angular/core/testing';
import { DestroyRef, EnvironmentInjector, Injectable, createEnvironmentInjector } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { PlayerService } from './player.service';
import { Player } from './player.model';
import * as firestoreModule from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Firebase mocks via vi.mock (hoisted automatically by Vitest)
// ---------------------------------------------------------------------------
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn().mockReturnValue({}),
  collection: vi.fn().mockReturnValue({}),
  onSnapshot: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock('firebase/app', () => ({
  getApps: vi.fn().mockReturnValue([{}]),
  initializeApp: vi.fn(),
}));

// Mutable flag to cause onSnapshot to throw on the next call
let shouldThrow = false;
let visibility: DocumentVisibilityState = 'visible';

// ---------------------------------------------------------------------------
// Types for the captured callbacks
// ---------------------------------------------------------------------------
type SnapshotCallback = (snapshot: { empty: boolean; docs: { data(): object }[] }) => void;
type ErrorCallback = (err: Error) => void;

// ---------------------------------------------------------------------------
// Harness that runs the REAL Firestore path
// ---------------------------------------------------------------------------
@Injectable()
class RealFirestoreHarness extends PlayerService {
  // Do not override — the constructor runs the real HTTP loadInitialPlayers(),
  // and each test opts into the real Firestore path via enableLiveUpdates().
}

const MOCK_HOUSE_MAPPING = {
  baseUrl: 'https://maps.example.com',
  players: {},
};

function makeDoc(overrides: object = {}) {
  return {
    data: () => ({
      name: 'Steve',
      uuid: 'aaaa-0001',
      level: 10,
      health: 20,
      dimension: 'Overworld',
      pos: [0, 64, 0],
      last_seen: '2026-01-01',
      skin_url: 'https://mc-heads.net/skin/Steve',
      is_raw_skin: false,
      advancement_count: 5,
      ...overrides,
    }),
  };
}

const ALEX = { name: 'Alex', uuid: 'bbbb-0002', level: 3 };

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('PlayerService – Firestore live updates', () => {
  let service: PlayerService;
  let httpMock: HttpTestingController;
  let capturedOnNext: SnapshotCallback | null = null;
  let capturedOnError: ErrorCallback | null = null;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let consumers: EnvironmentInjector[] = [];
  const onSnapshotMock = firestoreModule.onSnapshot as unknown as ReturnType<typeof vi.fn>;

  /** A stand-in for a consuming page: its DestroyRef fires on release(). */
  function enableLive(): EnvironmentInjector {
    const consumer = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    consumers.push(consumer);
    service.enableLiveUpdates(consumer.get(DestroyRef));
    return consumer;
  }

  function release(consumer: EnvironmentInjector): void {
    consumers = consumers.filter(c => c !== consumer);
    consumer.destroy();
  }

  async function listenerAttached(times = 1): Promise<void> {
    await vi.waitFor(() => {
      expect(onSnapshotMock).toHaveBeenCalledTimes(times);
    });
  }

  function setupService(): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PlayerService, useClass: RealFirestoreHarness },
      ],
    });

    service = TestBed.inject(PlayerService);
    httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne('assets/player-houses-mapping.json').flush(MOCK_HOUSE_MAPPING);
    // The constructor loads the roster over HTTP by default; flush that.
    httpMock.expectOne('/api/players').flush([]);
  }

  /** Service + one live consumer with the (mocked) listener attached. */
  async function bootstrapService(): Promise<EnvironmentInjector> {
    setupService();
    const consumer = enableLive();
    await listenerAttached();
    return consumer;
  }

  beforeEach(() => {
    capturedOnNext = null;
    capturedOnError = null;
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    unsubscribe = vi.fn();
    onSnapshotMock.mockReset();
    onSnapshotMock.mockImplementation(
      (_ref: unknown, onNext: SnapshotCallback, onError: ErrorCallback) => {
        if (shouldThrow) {
          throw new Error('Firestore init error');
        }
        capturedOnNext = onNext;
        capturedOnError = onError;
        return unsubscribe;
      }
    );
  });

  afterEach(() => {
    consumers.forEach(c => c.destroy());
    consumers = [];
    httpMock.verify();
    shouldThrow = false;
    Reflect.deleteProperty(document, 'visibilityState');
  });

  // ── snapshot ingest ───────────────────────────────────────────────────────

  it('calls fetchPlayersFromApi when the snapshot is empty', async () => {
    await bootstrapService();
    capturedOnNext?.({ empty: true, docs: [] });

    const req = httpMock.expectOne('/api/players');
    req.flush([]);
  });

  it('does not make HTTP call when snapshot data is unchanged', async () => {
    await bootstrapService();

    const doc = makeDoc();
    capturedOnNext?.({ empty: false, docs: [doc] });
    capturedOnNext?.({ empty: false, docs: [doc] });

    httpMock.expectNone('/api/players');
  });

  it('calls enrichFromApi when a player doc lacks advancement_count', async () => {
    await bootstrapService();

    capturedOnNext?.({ empty: false, docs: [makeDoc({ advancement_count: undefined })] });
    // Signal updated; enrichFromApi fires an HTTP request
    const req = httpMock.expectOne('/api/players');
    req.flush([{
      name: 'Steve',
      uuid: 'aaaa-0001',
      level: 10,
      health: 20,
      dimension: 'Overworld',
      pos: [0, 64, 0],
      last_seen: '2026-01-01',
      skin_url: 'https://mc-heads.net/skin/Steve',
      is_raw_skin: false,
      advancement_count: 42,
    }]);
    expect(service.players()[0]).toBeInstanceOf(Player);
    expect(service.players()[0]?.advancement_count).toBe(42);
  });

  // ── error fallbacks ───────────────────────────────────────────────────────

  it('calls fetchPlayersFromApi on Firestore listener error', async () => {
    await bootstrapService();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    capturedOnError?.(new Error('Firestore down'));

    expect(console.warn).toHaveBeenCalledWith(
      'Firestore player listener error:',
      expect.any(Error)
    );
    const req = httpMock.expectOne('/api/players');
    req.flush([]);
  });

  it('catches Firestore init errors and falls back to HTTP API', async () => {
    shouldThrow = true;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await bootstrapService();

    expect(console.warn).toHaveBeenCalledWith(
      'Could not initialize Firestore player listener:',
      expect.any(Error)
    );
    const req = httpMock.expectOne('/api/players');
    req.flush([]);
  });

  // ── listener lifecycle (ref-counted) ──────────────────────────────────────

  it('shares one listener between consumers and closes it only when the last one leaves', async () => {
    const first = await bootstrapService();
    const second = enableLive();
    await Promise.resolve();
    expect(onSnapshotMock).toHaveBeenCalledTimes(1);

    release(first);
    expect(unsubscribe).not.toHaveBeenCalled();

    release(second);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('reopens the listener for a later consumer after every previous one left', async () => {
    release(await bootstrapService());
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    enableLive();
    await listenerAttached(2);
  });

  it('never attaches the listener when the consumer is gone before the SDK loads', async () => {
    setupService();
    let resolveSdk: (sdk: typeof firestoreModule) => void = () => undefined;
    jest.spyOn(service as unknown as { loadFirestoreSdk(): Promise<typeof firestoreModule> }, 'loadFirestoreSdk')
      .mockReturnValue(new Promise(resolve => { resolveSdk = resolve; }));

    release(enableLive());
    resolveSdk(firestoreModule);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('detaches while the tab is hidden and re-attaches once it is visible again', async () => {
    await bootstrapService();

    setVisibility('hidden');
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await listenerAttached(2);
  });

  // ── structural sharing ────────────────────────────────────────────────────

  it('keeps the previous Player instance for players unchanged between snapshots', async () => {
    await bootstrapService();

    capturedOnNext?.({ empty: false, docs: [makeDoc(), makeDoc(ALEX)] });
    const before = service.players();
    capturedOnNext?.({ empty: false, docs: [makeDoc({ level: 11 }), makeDoc(ALEX)] });
    const after = service.players();

    const steveBefore = before.find(p => p.name === 'Steve');
    const steveAfter = after.find(p => p.name === 'Steve');
    expect(after.find(p => p.name === 'Alex')).toBe(before.find(p => p.name === 'Alex'));
    expect(steveAfter).not.toBe(steveBefore);
    expect(steveAfter?.level).toBe(11);
  });

  it('does not publish a new roster when a snapshot carries no changes', async () => {
    await bootstrapService();

    capturedOnNext?.({ empty: false, docs: [makeDoc(), makeDoc(ALEX)] });
    const before = service.players();
    // e.g. the full re-delivery after re-attaching on tab visibility
    capturedOnNext?.({ empty: false, docs: [makeDoc(), makeDoc(ALEX)] });

    expect(service.players()).toBe(before);
  });
});
