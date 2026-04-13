import type {
  AfterViewInit,
  ElementRef,
  OnDestroy} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
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
import type { Period, Snapshot } from '../../services/analytics/analytics.service';
import { AnalyticsService } from '../../services/analytics/analytics.service';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { LoadingService } from '../../services/loading/loading.service';
import { ThemeService } from '../../services/theme/theme.service';
import { PageContainerComponent } from '../../components/shared/page-container/page-container.component';

Chart.register(CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip, Filler);

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [IconComponent, PageContainerComponent],
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

  protected readonly period = signal<Period>('week');
  protected readonly hasData = signal(false);
  protected readonly peakOnline = signal(0);
  protected readonly avgOnline = signal(0);

  private chart?: Chart;
  private refreshTimer?: ReturnType<typeof setInterval>;

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
    void this.loadData();
    this.refreshTimer = setInterval(() => {
      void this.loadData();
    }, 60_000);
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    clearInterval(this.refreshTimer);
  }

  protected setPeriod(p: Period): void {
    this.period.set(p);
    void this.loadData();
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
          label: 'Players online',
          data: [],
          borderColor: 'rgb(34,197,94)',
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2,
        } as ChartDataset<'line'>],
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
              label: ctx => ` ${ctx.parsed.y} online`,
            },
          },
          legend: { display: false },
        },
      },
    });

    this.applyThemeToChart();
  }

  private async loadData(): Promise<void> {
    try {
      const snaps = await this.analyticsService.getSnapshots(this.period());
      this.updateChart(snaps);
    } catch {
      // error is already handled silently; loading state is managed by the interceptor
    }
  }

  private updateChart(snaps: Snapshot[]): void {
    if (!this.chart) return;

    this.hasData.set(snaps.length > 0);

    const buckets = this.bucket(snaps, this.period());
    const labels = buckets.map(b => b.label);
    const data   = buckets.map(b => b.avg);

    this.chart.data.labels = labels;
    (this.chart.data.datasets[0] as ChartDataset<'line'>).data = data;
    this.chart.update();

    const counts = snaps.map(s => s.count);
    this.peakOnline.set(counts.length ? Math.max(...counts) : 0);
    const sum = counts.reduce((a, b) => a + b, 0);
    this.avgOnline.set(counts.length ? Math.round(sum / counts.length) : 0);
  }

  /** Bucket raw minute-level snapshots into chart-friendly intervals */
  private bucket(snaps: Snapshot[], period: Period): { label: string; avg: number }[] {
    if (!snaps.length) return [];

    // Compute actual time span of the data, not just the period window.
    // If all data is recent (< 3 hours), use 15-minute buckets regardless of period.
    const first = snaps[0];
    const last = snaps.at(-1);
    if (!first || !last) return [];
    const spanSec = last.ts - first.ts;
    let size: number;
    if      (spanSec <= 3 * 3600)       size = 15 * 60;       // ≤3 h  → 15-min buckets
    else if (spanSec <= 24 * 3600)      size = 60 * 60;       // ≤1 d  → 1-hour buckets
    else if (spanSec <= 7 * 24 * 3600)  size = 6 * 60 * 60;   // ≤1 w  → 6-hour buckets
    else if (spanSec <= 30 * 24 * 3600) size = 24 * 60 * 60;  // ≤1 mo → daily buckets
    else                                size = 7 * 24 * 3600; // > 1 mo → weekly buckets

    // Override for day period: always show at least 15-min granularity
    if (period === 'day' && size > 15 * 60) size = 15 * 60;

    const map = new Map<number, number[]>();
    for (const s of snaps) {
      const key = Math.floor(s.ts / size) * size;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s.count);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, vals]) => ({
        label: this.formatTs(ts, period, size),
        avg: Math.max(...vals),
      }));
  }

  private formatTs(ts: number, _period: Period, bucketSize: number): string {
    const d = new Date(ts * 1000);
    if (bucketSize <= 15 * 60)         return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (bucketSize <= 60 * 60)         return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (bucketSize <= 6 * 60 * 60)     return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
    if (bucketSize <= 24 * 60 * 60)    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
