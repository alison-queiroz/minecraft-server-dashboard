import type {
  AfterViewInit,
  ElementRef,
  OnDestroy} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { EMPTY, Subject, concat, of, timer } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import { LucideChartLine } from '@lucide/angular';
import {
  Chart,
  CategoryScale,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  Filler,
  type ChartDataset,
} from 'chart.js';
import type { AnalyticsSeries, Period } from '../../services/analytics/analytics.service';
import { AnalyticsService } from '../../services/analytics/analytics.service';
import { EmptyStateComponent } from '../../components/shared/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../components/shared/page-header/page-header.component';
import { LoadingService } from '../../services/loading/loading.service';
import { ThemeService } from '../../services/theme/theme.service';
import { PageContainerComponent } from '../../components/shared/page-container/page-container.component';
import { pageVisible$ } from '../../utils/page-visibility.util';

Chart.register(CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip, Filler);

/**
 * Silent auto-refresh cadence per period, matched to the backend bucket width
 * (`_PERIOD_BUCKET_SECONDS` in api/routes/analytics.py): the 24 h view's live 15-min
 * bucket moves every minute, 6 h / 1 d buckets barely move between polls, and
 * the 1 y view's 7-day buckets effectively never do — polling it would only
 * make the server re-read a year of snapshots for no visible change.
 */
const REFRESH_INTERVAL_MS: Readonly<Record<Period, number | null>> = {
  day: 60_000,
  week: 5 * 60_000,
  month: 15 * 60_000,
  year: null,
};

interface LoadResult {
  period: Period;
  /** Null when the request failed. */
  series: AnalyticsSeries | null;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [EmptyStateComponent, PageHeaderComponent, PageContainerComponent],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsComponent implements AfterViewInit, OnDestroy {
  protected readonly LucideChartLine = LucideChartLine;

  @ViewChild('chartCanvas') private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly analyticsService = inject(AnalyticsService);
  protected readonly loadingService = inject(LoadingService);
  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  protected readonly period = signal<Period>('week');
  protected readonly hasData = signal(false);
  protected readonly hasError = signal(false);
  protected readonly peakOnline = signal(0);
  protected readonly avgOnline = signal(0);

  private chart?: Chart;
  private readonly periodChanges = new Subject<Period>();

  readonly periods: { key: Period; label: string }[] = [
    { key: 'day',   label: '24 h' },
    { key: 'week',  label: '7 d' },
    { key: 'month', label: '30 d' },
    { key: 'year',  label: '1 y' },
  ];

  constructor() {
    effect(() => {
      this.themeService.isDark();
      this.applyThemeToChart();
    });
  }

  ngAfterViewInit(): void {
    this.buildChart();
    // Every load (period switch or poll) goes through one switchMap chain, so a
    // newer request cancels the in-flight one and an older response can never
    // overwrite the chart with another period's data.
    this.periodChanges.pipe(
      startWith(this.period()),
      switchMap(period => this.loadTriggers(period).pipe(
        switchMap(background => this.fetchSeries(period, background)),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ period, series }) => {
      if (!series) {
        // Surface a distinct error state instead of masking failures as "no data".
        this.hasError.set(true);
        return;
      }
      this.hasError.set(false);
      this.updateChart(series, period);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  protected setPeriod(p: Period): void {
    this.period.set(p);
    this.periodChanges.next(p);
  }

  /**
   * Emits `false` once for the user-visible load, then `true` for each silent
   * refresh. Refreshes pause while the tab is hidden and fire once as soon as
   * it is visible again before resuming the period's cadence.
   */
  private loadTriggers(period: Period): Observable<boolean> {
    const every = REFRESH_INTERVAL_MS[period];
    if (every === null) return of(false);

    const refreshes = pageVisible$(this.document).pipe(
      switchMap((visible, i) => visible ? timer(i === 0 ? every : 0, every) : EMPTY),
      map(() => true),
    );
    return concat(of(false), refreshes);
  }

  private fetchSeries(period: Period, background: boolean): Observable<LoadResult> {
    return this.analyticsService.getSeries(period, { background }).pipe(
      map((series): LoadResult => ({ period, series })),
      catchError(() => of<LoadResult>({ period, series: null })),
    );
  }

  private buildChart(): void {
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const palette = this.getThemePalette();

    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(34,197,94,0.35)');
    gradient.addColorStop(1, 'rgba(34,197,94,0)');

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Peak online',
          data: [],
          borderColor: 'rgb(34,197,94)',
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
          x: {
            ticks: { color: palette.axisLabel, maxTicksLimit: 8, maxRotation: 0 },
            grid: { color: palette.gridLine },
          },
          y: {
            beginAtZero: true,
            ticks: { color: palette.axisLabel, stepSize: 1 },
            grid: { color: palette.gridLine },
          },
        },
        plugins: {
          tooltip: {
            backgroundColor: palette.tooltipBackground,
            titleColor: palette.tooltipText,
            bodyColor: palette.tooltipText,
            callbacks: {
              label: ctx => ` ${ctx.parsed.y} peak online`,
            },
          },
          legend: { display: false },
        },
      },
    });

    this.applyThemeToChart();
  }

  /**
   * Thin renderer: the backend already returns pre-bucketed points and a
   * peak/avg summary, so the component only maps them onto the chart and
   * formats each bucket's timestamp as a label (presentation only).
   */
  private updateChart(series: AnalyticsSeries, period: Period): void {
    if (!this.chart) return;

    this.hasData.set(series.points.length > 0);

    this.chart.data.labels = series.points.map(p => this.formatTs(p.t, period));
    // Plot the per-bucket PEAK: on a small, mostly-empty server the true average
    // rounds to 0 in almost every bucket, so an avg line reads as a flat zero.
    // The Avg-online summary card still shows the true mean.
    (this.chart.data.datasets[0] as ChartDataset<'line'>).data = series.points.map(p => p.peak);
    this.chart.update();

    this.peakOnline.set(series.summary.peak);
    this.avgOnline.set(series.summary.avg);
  }

  /** Formats a bucket-start timestamp into a chart label based on the period. */
  private formatTs(ts: number, period: Period): string {
    const d = new Date(ts * 1000);
    switch (period) {
      case 'day':   return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      case 'week':  return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
      case 'month': return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      case 'year':  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  private getThemePalette(): {
    axisLabel: string;
    gridLine: string;
    tooltipBackground: string;
    tooltipText: string;
  } {
    if (this.themeService.isDark()) {
      return {
        axisLabel: '#9ca3af',
        gridLine: 'rgba(255,255,255,0.06)',
        tooltipBackground: '#18181b',
        tooltipText: '#f4f4f5',
      };
    }

    return {
      axisLabel: '#52525b',
      gridLine: 'rgba(24,24,27,0.08)',
      tooltipBackground: '#fafafa',
      tooltipText: '#18181b',
    };
  }

  private applyThemeToChart(): void {
    if (!this.chart) return;

    const palette = this.getThemePalette();
    const xScale = this.chart.options.scales?.['x'];
    const yScale = this.chart.options.scales?.['y'];

    if (xScale) {
      xScale.ticks = { ...xScale.ticks, color: palette.axisLabel };
      xScale.grid = { ...xScale.grid, color: palette.gridLine };
    }

    if (yScale) {
      yScale.ticks = { ...yScale.ticks, color: palette.axisLabel };
      yScale.grid = { ...yScale.grid, color: palette.gridLine };
    }

    const tooltip = this.chart.options.plugins?.tooltip;
    if (tooltip) {
      tooltip.backgroundColor = palette.tooltipBackground;
      tooltip.titleColor = palette.tooltipText;
      tooltip.bodyColor = palette.tooltipText;
    }

    this.chart.update('none');
  }
}
