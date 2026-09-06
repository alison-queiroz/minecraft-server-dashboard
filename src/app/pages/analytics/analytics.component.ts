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
import type { AnalyticsSeries, Period } from '../../services/analytics/analytics.service';
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
  protected readonly hasError = signal(false);
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
          label: 'Peak online',
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
              label: ctx => ` ${ctx.parsed.y} peak online`,
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
      const series = await this.analyticsService.getSeries(this.period());
      this.hasError.set(false);
      this.updateChart(series);
    } catch {
      // Surface a distinct error state instead of masking failures as "no data".
      this.hasError.set(true);
    }
  }

  /**
   * Thin renderer: the backend already returns pre-bucketed points and a
   * peak/avg summary, so the component only maps them onto the chart and
   * formats each bucket's timestamp as a label (presentation only).
   */
  private updateChart(series: AnalyticsSeries): void {
    if (!this.chart) return;

    this.hasData.set(series.points.length > 0);

    const period = this.period();
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
