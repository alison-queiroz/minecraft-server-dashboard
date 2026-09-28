import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import type { Observable } from 'rxjs';
import { Subject, of, throwError } from 'rxjs';
import { AnalyticsComponent } from './analytics.component';
import { AnalyticsService } from '../../services/analytics/analytics.service';
import type { AnalyticsSeries, Period, SeriesRequestOptions } from '../../services/analytics/analytics.service';
import { LoadingService } from '../../services/loading/loading.service';
import { ThemeService } from '../../services/theme/theme.service';

// Stub Chart.js so the component builds a chart without a real canvas context.
vi.mock('chart.js', () => {
  class MockChart {
    static register = vi.fn();
    data: { labels: unknown[]; datasets: { data: unknown[] }[] };
    options: Record<string, unknown>;
    constructor(_ctx: unknown, config: { data: MockChart['data']; options: MockChart['options'] }) {
      this.data = config.data;
      this.options = config.options;
    }
    update(): void { /* noop */ }
    destroy(): void { /* noop */ }
  }
  const passthrough = class {};
  return {
    Chart: MockChart,
    CategoryScale: passthrough,
    LineController: passthrough,
    LineElement: passthrough,
    LinearScale: passthrough,
    PointElement: passthrough,
    Tooltip: passthrough,
    Filler: passthrough,
  };
});

interface ComponentInternals {
  peakOnline(): number;
  avgOnline(): number;
  hasData(): boolean;
  hasError(): boolean;
  setPeriod(p: Period): void;
  formatTs(ts: number, period: string): string;
  chart: { data: { datasets: { data: number[] }[] } };
}

type GetSeries = (period: Period, options?: SeriesRequestOptions) => Observable<AnalyticsSeries>;

const SERIES: AnalyticsSeries = {
  points: [
    { t: 0, avg: 2, peak: 5 },
    { t: 3600, avg: 3, peak: 4 },
  ],
  summary: { peak: 5, avg: 2 },
};

const DAY_SERIES: AnalyticsSeries = {
  points: [{ t: 0, avg: 1, peak: 9 }],
  summary: { peak: 9, avg: 1 },
};

const MINUTE = 60_000;

function makeComponent(getSeries: GetSeries) {
  TestBed.configureTestingModule({
    imports: [AnalyticsComponent],
    providers: [
      { provide: AnalyticsService, useValue: { getSeries } },
      { provide: LoadingService, useValue: { isLoading: signal(false) } },
      { provide: ThemeService, useValue: { isDark: signal(false) } },
    ],
  });
  const fixture = TestBed.createComponent(AnalyticsComponent);
  return fixture;
}

function internals(fixture: ReturnType<typeof makeComponent>): ComponentInternals {
  return fixture.componentInstance as unknown as ComponentInternals;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function backgroundCalls(getSeries: ReturnType<typeof vi.fn<GetSeries>>): number {
  return getSeries.mock.calls.filter(([, options]) => options?.background === true).length;
}

beforeEach(() => {
  // jsdom canvases return null for getContext; provide a minimal 2D stub.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('AnalyticsComponent', () => {
  it('renders peak/avg from the backend summary (not a client-side re-derivation)', async () => {
    const getSeries = vi.fn<GetSeries>(() => of(SERIES));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();      // triggers ngAfterViewInit -> first load
    await fixture.whenStable();

    const cmp = internals(fixture);
    expect(getSeries).toHaveBeenCalledWith('week', { background: false });
    // summary.peak = 5, summary.avg = 2 — the avg tile must be the mean, not the peak.
    expect(cmp.peakOnline()).toBe(5);
    expect(cmp.avgOnline()).toBe(2);
    expect(cmp.hasData()).toBe(true);
    expect(cmp.hasError()).toBe(false);

    // The chart line plots the per-bucket PEAK (a mostly-empty server's avg is ~0).
    expect(cmp.chart.data.datasets[0].data).toEqual([5, 4]);
    fixture.destroy();
  });

  it('sets an error state (not "no data") when the fetch fails', async () => {
    const getSeries = vi.fn<GetSeries>(() => throwError(() => new Error('500')));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();
    await fixture.whenStable();

    const cmp = internals(fixture);
    expect(cmp.hasError()).toBe(true);
    expect(cmp.hasData()).toBe(false);
    fixture.destroy();
  });

  it('formats bucket timestamps per period', async () => {
    const fixture = makeComponent(vi.fn<GetSeries>(() => of(SERIES)));
    fixture.detectChanges();
    await fixture.whenStable();
    const cmp = internals(fixture);

    const ts = Date.UTC(2026, 0, 5, 14, 30) / 1000;
    // Day period → a time label; month/year → a date label. Exact locale text
    // varies, so assert they differ in shape rather than exact strings.
    const dayLabel = cmp.formatTs(ts, 'day');
    const monthLabel = cmp.formatTs(ts, 'month');
    expect(typeof dayLabel).toBe('string');
    expect(dayLabel.length).toBeGreaterThan(0);
    expect(monthLabel).not.toBe(dayLabel);
    fixture.destroy();
  });

  it('ignores a stale response when the period changes while a load is in flight', () => {
    const week$ = new Subject<AnalyticsSeries>();
    const day$ = new Subject<AnalyticsSeries>();
    const getSeries = vi.fn<GetSeries>(period => (period === 'week' ? week$ : day$));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();
    const cmp = internals(fixture);

    cmp.setPeriod('day');
    day$.next(DAY_SERIES);
    // The superseded 'week' request was unsubscribed (cancelled) by switchMap,
    // so even if it answered now it could not overwrite the 24 h chart.
    expect(week$.observed).toBe(false);
    week$.next(SERIES);

    expect(cmp.chart.data.datasets[0].data).toEqual([9]);
    expect(cmp.peakOnline()).toBe(9);
    fixture.destroy();
  });

  it('refreshes the 24 h view silently every minute', () => {
    vi.useFakeTimers();
    const getSeries = vi.fn<GetSeries>(() => of(SERIES));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();
    internals(fixture).setPeriod('day');

    expect(getSeries).toHaveBeenLastCalledWith('day', { background: false });
    vi.advanceTimersByTime(MINUTE);
    expect(getSeries).toHaveBeenLastCalledWith('day', { background: true });
    vi.advanceTimersByTime(MINUTE);
    expect(backgroundCalls(getSeries)).toBe(2);
    fixture.destroy();
  });

  it('scales the refresh interval with the period (7 d view every 5 minutes)', () => {
    vi.useFakeTimers();
    const getSeries = vi.fn<GetSeries>(() => of(SERIES));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();

    vi.advanceTimersByTime(4 * MINUTE);
    expect(backgroundCalls(getSeries)).toBe(0);
    vi.advanceTimersByTime(MINUTE);
    expect(backgroundCalls(getSeries)).toBe(1);
    fixture.destroy();
  });

  it('does not poll the 1 y view at all', () => {
    vi.useFakeTimers();
    const getSeries = vi.fn<GetSeries>(() => of(SERIES));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();
    internals(fixture).setPeriod('year');

    vi.advanceTimersByTime(24 * 60 * MINUTE);
    expect(getSeries).toHaveBeenCalledTimes(2); // initial 'week' + user-selected 'year'
    expect(backgroundCalls(getSeries)).toBe(0);
    fixture.destroy();
  });

  it('pauses while the tab is hidden and refreshes once when it is visible again', () => {
    vi.useFakeTimers();
    const getSeries = vi.fn<GetSeries>(() => of(SERIES));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();
    internals(fixture).setPeriod('day');

    setVisibility('hidden');
    vi.advanceTimersByTime(30 * MINUTE);
    expect(backgroundCalls(getSeries)).toBe(0);

    setVisibility('visible');
    vi.advanceTimersByTime(0);
    expect(backgroundCalls(getSeries)).toBe(1);
    expect(getSeries).toHaveBeenLastCalledWith('day', { background: true });

    vi.advanceTimersByTime(MINUTE);
    expect(backgroundCalls(getSeries)).toBe(2);
    fixture.destroy();
  });

  it('stops polling once destroyed', () => {
    vi.useFakeTimers();
    const getSeries = vi.fn<GetSeries>(() => of(SERIES));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();
    internals(fixture).setPeriod('day');
    fixture.destroy();

    const callsAtDestroy = getSeries.mock.calls.length;
    vi.advanceTimersByTime(10 * MINUTE);
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(MINUTE);
    expect(getSeries).toHaveBeenCalledTimes(callsAtDestroy);
  });
});
