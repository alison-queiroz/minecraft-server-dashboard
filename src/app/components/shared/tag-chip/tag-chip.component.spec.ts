import type { ComponentFixture} from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { TagChipComponent } from './tag-chip.component';

describe('TagChipComponent', () => {
  let fixture: ComponentFixture<TagChipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TagChipComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TagChipComponent);
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should default color to zinc', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.color).toBe('zinc');
  });

  it('should set data-color attribute from color input', () => {
    fixture.componentInstance.color = 'green';
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-color')).toBe('green');
  });

  it('should set data-color attribute to dim', () => {
    fixture.componentInstance.color = 'dim';
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-color')).toBe('dim');
  });
});
