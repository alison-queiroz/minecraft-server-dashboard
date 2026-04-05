import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';
import { LucideHouse } from '@lucide/angular';

describe('IconComponent', () => {
  let fixture: ComponentFixture<IconComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconComponent],
      providers: [],
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
});



