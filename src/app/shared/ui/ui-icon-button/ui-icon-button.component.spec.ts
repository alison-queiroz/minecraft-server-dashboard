import type { ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiIconButtonComponent } from './ui-icon-button.component';

describe('UiIconButtonComponent', () => {
  let fixture: ComponentFixture<UiIconButtonComponent>;
  let component: UiIconButtonComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiIconButtonComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(UiIconButtonComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('ariaLabel', 'Open details');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('emits activated when clicked and enabled', () => {
    const emitSpy = jest.spyOn(component.activated, 'emit');
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('does not emit activated when disabled', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const emitSpy = jest.spyOn(component.activated, 'emit');
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
