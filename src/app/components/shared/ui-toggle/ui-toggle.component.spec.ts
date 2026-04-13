import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { UiToggleComponent } from './ui-toggle.component';

describe('UiToggleComponent', () => {
  let fixture: ComponentFixture<UiToggleComponent>;
  let component: UiToggleComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiToggleComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UiToggleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the label text', () => {
    fixture.componentRef.setInput('label', 'Enable feature');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Enable feature');
  });

  it('renders the note when provided', () => {
    fixture.componentRef.setInput('note', 'This is a note');
    fixture.detectChanges();
    const note = (fixture.nativeElement as HTMLElement).querySelector('.ui-toggle__note');
    expect(note?.textContent?.trim()).toBe('This is a note');
  });

  it('does not render the note element when note is empty', () => {
    const note = (fixture.nativeElement as HTMLElement).querySelector('.ui-toggle__note');
    expect(note).toBeNull();
  });

  it('checkbox is checked when checked input is true', () => {
    fixture.componentRef.setInput('checked', true);
    fixture.detectChanges();
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);
  });

  it('checkbox is unchecked when checked input is false', () => {
    fixture.componentRef.setInput('checked', false);
    fixture.detectChanges();
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
  });

  it('emits checkedChange with true when checking the checkbox', () => {
    const spy = jest.spyOn(component.checkedChange, 'emit');
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith(true);
  });

  it('emits checkedChange with false when unchecking the checkbox', () => {
    fixture.componentRef.setInput('checked', true);
    fixture.detectChanges();
    const spy = jest.spyOn(component.checkedChange, 'emit');
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith(false);
  });
});
