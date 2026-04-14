import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { DimensionTagComponent } from './dimension-tag.component';

describe('DimensionTagComponent', () => {
  let fixture: ComponentFixture<DimensionTagComponent>;
  let component: DimensionTagComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DimensionTagComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DimensionTagComponent);
    component = fixture.componentInstance;
  });

  it('maps known worlds case-insensitively', () => {
    fixture.componentRef.setInput('world', 'WORLD_NETHER');
    fixture.detectChanges();
    expect(component.label).toBe('Nether');
    expect(component.color).toBe('orange');
  });

  it('falls back to raw world value and zinc color for unknown worlds', () => {
    fixture.componentRef.setInput('world', 'moon');
    fixture.detectChanges();
    expect(component.label).toBe('moon');
    expect(component.color).toBe('zinc');
  });
});