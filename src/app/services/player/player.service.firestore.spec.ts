/**
 * Covers the `subscribeToFirestorePlayers` branch paths that the main spec
 * bypasses via the PlayerServiceHarness override.
 */
import { TestBed } from '@angular/core/testing';
import { Injectable } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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

// ---------------------------------------------------------------------------
// Types for the captured callbacks
// ---------------------------------------------------------------------------
type SnapshotCallback = (snapshot: { empty: boolean; docs: { data(): object }[] }) => void;
type ErrorCallback = (err: Error) => void;

// ---------------------------------------------------------------------------
// Harness that calls the REAL subscribeToFirestorePlayers
// ---------------------------------------------------------------------------
@Injectable()
class RealFirestoreHarness extends PlayerService {
  // Do not override — let real subscribeToFirestorePlayers() run
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('PlayerService – subscribeToFirestorePlayers branches', () => {
  let service: PlayerService;
  let httpMock: HttpTestingController;
  let capturedOnNext: SnapshotCallback | null = null;
  let capturedOnError: ErrorCallback | null = null;

  function bootstrapService() {
    capturedOnNext = null;
    capturedOnError = null;

    const mockFn = firestoreModule.onSnapshot as unknown as ReturnType<typeof vi.fn>;
    mockFn.mockReset();
    mockFn.mockImplementation(
      (_ref: unknown, onNext: SnapshotCallback, onError: ErrorCallback) => {
        if (shouldThrow) {
          throw new Error('Firestore init error');
        }
        capturedOnNext = onNext;
        capturedOnError = onError;
        return () => undefined;
      }
    );

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
  }

  afterEach(() => {
    httpMock.verify();
    shouldThrow = false;
  });

  // ── empty snapshot → falls back to HTTP API ───────────────────────────────

  it('calls fetchPlayersFromApi when the snapshot is empty', () => {
    bootstrapService();
    capturedOnNext?.({ empty: true, docs: [] });

    const req = httpMock.expectOne('/api/players');
    req.flush([]);
  });

  // ── unchanged snapshot → early return (no signal update) ─────────────────

  it('does not make HTTP call when snapshot data is unchanged', () => {
    bootstrapService();

    const doc = makeDoc();
    capturedOnNext?.({ empty: false, docs: [doc] });

    // Push same snapshot again — changed=false path → no HTTP call
    capturedOnNext?.({ empty: false, docs: [doc] });

    httpMock.expectNone('/api/players');
  });

  // ── advancement_count undefined → enrichFromApi ───────────────────────────

  it('calls enrichFromApi when a player doc lacks advancement_count', () => {
    bootstrapService();

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
  });

  // ── listener error callback → falls back to HTTP ──────────────────────────

  it('calls fetchPlayersFromApi on Firestore listener error', () => {
    bootstrapService();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    capturedOnError?.(new Error('Firestore down'));

    expect(console.warn).toHaveBeenCalledWith(
      'Firestore player listener error:',
      expect.any(Error)
    );
    const req = httpMock.expectOne('/api/players');
    req.flush([]);
  });

  // ── try/catch around Firestore init ───────────────────────────────────────

  it('catches Firestore init errors and falls back to HTTP API', () => {
    shouldThrow = true;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    bootstrapService();

    expect(console.warn).toHaveBeenCalledWith(
      'Could not initialize Firestore player listener:',
      expect.any(Error)
    );
    const req = httpMock.expectOne('/api/players');
    req.flush([]);
  });
});
