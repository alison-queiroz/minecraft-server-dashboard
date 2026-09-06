import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { AnalyticsComponent } from './analytics.component';
import { AnalyticsService } from '../../services/analytics/analytics.service';
import type { AnalyticsSeries } from '../../services/analytics/analytics.service';
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
  formatTs(ts: number, period: string): string;
}

const SERIES: AnalyticsSeries = {
  points: [
    { t: 0, avg: 2, peak: 5 },
    { t: 3600, avg: 3, peak: 4 },
  ],
  summary: { peak: 5, avg: 2 },
};

function makeComponent(getSeries: ReturnType<typeof vi.fn>) {
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

beforeEach(() => {
  // jsdom canvases return null for getContext; provide a minimal 2D stub.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe('AnalyticsComponent', () => {
  it('renders peak/avg from the backend summary (not a client-side re-derivation)', async () => {
    const getSeries = vi.fn().mockResolvedValue(SERIES);
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();      // triggers ngAfterViewInit -> loadData
    await fixture.whenStable();

    const cmp = fixture.componentInstance as unknown as ComponentInternals;
    expect(getSeries).toHaveBeenCalledWith('week');
    // summary.peak = 5, summary.avg = 2 — the avg tile must be the mean, not the peak.
    expect(cmp.peakOnline()).toBe(5);
    expect(cmp.avgOnline()).toBe(2);
    expect(cmp.hasData()).toBe(true);
    expect(cmp.hasError()).toBe(false);
    fixture.destroy();
  });

  it('sets an error state (not "no data") when the fetch rejects', async () => {
    const getSeries = vi.fn().mockRejectedValue(new Error('500'));
    const fixture = makeComponent(getSeries);
    fixture.detectChanges();
    await fixture.whenStable();

    const cmp = fixture.componentInstance as unknown as ComponentInternals;
    expect(cmp.hasError()).toBe(true);
    expect(cmp.hasData()).toBe(false);
    fixture.destroy();
  });

  it('formats bucket timestamps per period', async () => {
    const fixture = makeComponent(vi.fn().mockResolvedValue(SERIES));
    fixture.detectChanges();
    await fixture.whenStable();
    const cmp = fixture.componentInstance as unknown as ComponentInternals;

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
});
