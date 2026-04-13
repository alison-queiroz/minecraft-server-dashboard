import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { UiInputComponent } from './ui-input.component';

describe('UiInputComponent', () => {
  let fixture: ComponentFixture<UiInputComponent>;
  let component: UiInputComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiInputComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UiInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults to type="text"', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.getAttribute('type')).toBe('text');
  });

  it('sets the type attribute from input', () => {
    fixture.componentRef.setInput('type', 'number');
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.getAttribute('type')).toBe('number');
  });

  it('reflects the value on the input element', () => {
    fixture.componentRef.setInput('value', 'hello');
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('hello');
  });

  it('sets the placeholder attribute', () => {
    fixture.componentRef.setInput('placeholder', 'Enter text');
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.getAttribute('placeholder')).toBe('Enter text');
  });

  it('sets maxlength attribute when provided', () => {
    fixture.componentRef.setInput('maxlength', 50);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.getAttribute('maxlength')).toBe('50');
  });

  it('omits maxlength attribute when not provided', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.getAttribute('maxlength')).toBeNull();
  });

  it('sets readonly attribute when readonly is true', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.hasAttribute('readonly')).toBe(true);
  });

  it('omits readonly attribute when readonly is false', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.hasAttribute('readonly')).toBe(false);
  });

  it('emits valueChange on input event', () => {
    const spy = jest.spyOn(component.valueChange, 'emit');
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input')!;
    input.value = 'typed text';
    input.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith('typed text');
  });

  it('does not add accent class for default emerald accent', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.classList.contains('focus-accent-blue')).toBe(false);
    expect(input.classList.contains('focus-accent-orange')).toBe(false);
  });

  it('adds focus-accent-blue class when accent is blue', () => {
    fixture.componentRef.setInput('accent', 'blue');
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.classList.contains('focus-accent-blue')).toBe(true);
  });

  it('adds focus-accent-orange class when accent is orange', () => {
    fixture.componentRef.setInput('accent', 'orange');
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.classList.contains('focus-accent-orange')).toBe(true);
  });
});
