import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { CardSkeletonComponent } from './card-skeleton.component';

describe('CardSkeletonComponent', () => {
  let fixture: ComponentFixture<CardSkeletonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardSkeletonComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CardSkeletonComponent);
    fixture.detectChanges();
  });

  it('renders a hero and five card placeholders (3 + 2 columns)', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.sk-hero')).toBeTruthy();
    expect(el.querySelectorAll('.sk-card').length).toBe(5);
  });

  it('exposes an aria-busy status region for assistive tech', () => {
    const region = (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');
    expect(region?.getAttribute('aria-busy')).toBe('true');
  });
});
