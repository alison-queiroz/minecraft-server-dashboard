import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActionButtonComponent } from './action-button.component';

interface ActionButtonTestAccess {
  handleClick(): void;
}

function asActionButtonTestAccess(component: ActionButtonComponent): ActionButtonTestAccess {
  return component as unknown as ActionButtonTestAccess;
}

describe('ActionButtonComponent', () => {
  let fixture: ComponentFixture<ActionButtonComponent>;
  let component: ActionButtonComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActionButtonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ActionButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('handleClick emits pressed when not disabled', () => {
    const emitSpy = spyOn(component.pressed, 'emit');
    asActionButtonTestAccess(component).handleClick();
    expect(emitSpy).toHaveBeenCalled();
  });

  it('handleClick does NOT emit pressed when disabled', () => {
    component.disabled = true;
    const emitSpy = spyOn(component.pressed, 'emit');
    asActionButtonTestAccess(component).handleClick();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('defaults to primary variant', () => {
    expect(component.variant).toBe('primary');
  });

  it('applies variant input', () => {
    component.variant = 'secondary';
    fixture.detectChanges();
    expect(component.variant).toBe('secondary');
  });
});
