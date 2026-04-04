/**
 * Lightweight SVG icon renderer.
 *
 * Uses each Lucide icon's static `icon.node` data directly via Renderer2 —
 * NO LucideDynamicIcon, NO LUCIDE_ICONS injection token, NO all-icons registry.
 * Only the specific icon classes imported per-component end up in the bundle.
 */
import { ChangeDetectionStrategy, Component, ElementRef, Renderer2, effect, inject, input, viewChild } from '@angular/core';
import type { LucideIcon } from '@lucide/angular';

type IconNode = [tag: string, attrs: Record<string, string | number>, children?: IconNode[]];
interface LucideStaticIcon { node: IconNode[] }

function renderNodes(nodes: IconNode[], parent: Element, renderer: Renderer2): void {
  for (const [tag, attrs, children = []] of nodes) {
    const el: Element = renderer.createElement(tag, 'svg');
    for (const [k, v] of Object.entries(attrs)) {
      if (k !== 'key') renderer.setAttribute(el, k, String(v));
    }
    renderNodes(children, el, renderer);
    renderer.appendChild(parent, el);
  }
}

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg #svgEl
    xmlns="http://www.w3.org/2000/svg"
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="strokeWidth()"
    stroke-linecap="round"
    stroke-linejoin="round"
  ></svg>`,
  host: { style: 'display:inline-flex;line-height:0;vertical-align:middle;' },
})
export class IconComponent {
  private readonly renderer = inject(Renderer2);

  readonly icon = input.required<LucideIcon>();
  readonly size = input<number | string>(16);
  readonly strokeWidth = input<number | string>(2);

  private readonly svgEl = viewChild.required<ElementRef<SVGElement>>('svgEl');

  constructor() {
    effect(() => {
      const data = ((this.icon() as unknown) as { icon?: LucideStaticIcon }).icon;
      const nodes = data?.node ?? [];
      const svg = this.svgEl().nativeElement;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      renderNodes(nodes, svg, this.renderer);
    });
  }
}
