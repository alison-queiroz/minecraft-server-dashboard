import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { IconMapPinComponent } from './icon-map-pin.component';

describe('IconMapPinComponent', () => {
  let fixture: ComponentFixture<IconMapPinComponent>;
  let component: IconMapPinComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconMapPinComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(IconMapPinComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders an svg element', () => {
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('defaults to size 14', () => {
    expect(component.size()).toBe(14);
  });

  it('passes size to the svg', () => {
    fixture.componentRef.setInput('size', 20);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
  });
});
