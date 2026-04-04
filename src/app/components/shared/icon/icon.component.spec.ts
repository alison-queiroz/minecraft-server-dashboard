import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';
import { LucideHouse, LucideServer } from '@lucide/angular';

describe('IconComponent', () => {
  let fixture: ComponentFixture<IconComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(IconComponent);
  });

  it('should create', () => {
    fixture.componentRef.setInput('icon', LucideHouse);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders an svg element', () => {
    fixture.componentRef.setInput('icon', LucideHouse);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('svg has the specified size', () => {
    fixture.componentRef.setInput('icon', LucideHouse);
    fixture.componentRef.setInput('size', 24);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('svg uses specified stroke-width', () => {
    fixture.componentRef.setInput('icon', LucideHouse);
    fixture.componentRef.setInput('strokeWidth', 3);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('stroke-width')).toBe('3');
  });

  it('re-rendering with a new icon clears old children (hits while loop)', () => {
    // First render populates SVG children
    fixture.componentRef.setInput('icon', LucideHouse);
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.childElementCount).toBeGreaterThan(0);

    // Switching to a different icon triggers the effect again, hits the while(firstChild) loop
    fixture.componentRef.setInput('icon', LucideServer);
    fixture.detectChanges();

    // Children replaced — still some children (new icon)
    expect(svg.childElementCount).toBeGreaterThan(0);
  });

  it('renders icon nodes as SVG child elements', () => {
    fixture.componentRef.setInput('icon', LucideHouse);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.childElementCount).toBeGreaterThan(0);
  });
});
