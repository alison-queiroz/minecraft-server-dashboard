/**
 * Lightweight SVG icon renderer.
 *
 * Uses each Lucide icon's static `icon.node` data directly via Renderer2 —
 * NO LucideDynamicIcon, NO LUCIDE_ICONS injection token, NO all-icons registry.
 * Only the specific icon classes imported per-component end up in the bundle.
 */
import type { ElementRef} from '@angular/core';
import { ChangeDetectionStrategy, Component, Renderer2, effect, inject, input, viewChild } from '@angular/core';
import type { LucideIcon } from '@lucide/angular';

type IconNode = [tag: string, attrs: Record<string, string | number>, children?: IconNode[]];

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon.component.html',
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
      const nodes = this.resolveIconNodes(this.icon() as unknown);
      const svg = this.svgEl().nativeElement;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      this.renderNodes(nodes, svg);
    });
  }

  private resolveIconNodes(iconValue: unknown): IconNode[] {
    if (!iconValue || typeof iconValue !== 'object') {
      return [];
    }

    const maybeIcon = (iconValue as { icon?: unknown }).icon;
    if (!maybeIcon || typeof maybeIcon !== 'object') {
      return [];
    }

    const maybeNode = (maybeIcon as { node?: unknown }).node;
    if (!Array.isArray(maybeNode)) {
      return [];
    }

    return maybeNode.filter(node => this.isIconNode(node));
  }

  private isIconNode(value: unknown): value is IconNode {
    if (!Array.isArray(value) || value.length < 2) {
      return false;
    }

    const [rawTag, rawAttrs, rawChildren] = value as [unknown, unknown, unknown?];

    if (typeof rawTag !== 'string') {
      return false;
    }

    if (!rawAttrs || typeof rawAttrs !== 'object' || Array.isArray(rawAttrs)) {
      return false;
    }

    if (rawChildren === undefined) {
      return true;
    }

    return Array.isArray(rawChildren) && rawChildren.every(node => this.isIconNode(node));
  }

  private createSvgElement(tag: string): Element {
    return this.renderer.createElement(tag, 'svg') as Element;
  }

  private renderNodes(nodes: IconNode[], parent: Element): void {
    for (const [tag, attrs, children = []] of nodes) {
      const el = this.createSvgElement(tag);
      for (const key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) {
          continue;
        }
        if (key === 'key') {
          continue;
        }
        this.renderer.setAttribute(el, key, String(attrs[key]));
      }
      this.renderNodes(children, el);
      this.renderer.appendChild(parent, el);
    }
  }
}
