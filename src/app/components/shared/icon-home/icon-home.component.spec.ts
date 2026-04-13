import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { IconHomeComponent } from './icon-home.component';

describe('IconHomeComponent', () => {
  let fixture: ComponentFixture<IconHomeComponent>;
  let component: IconHomeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconHomeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(IconHomeComponent);
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
    fixture.componentRef.setInput('size', 24);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });
});
