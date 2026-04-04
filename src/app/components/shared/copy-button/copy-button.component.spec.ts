import type { ComponentFixture} from '@angular/core/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CopyButtonComponent } from './copy-button.component';

type WritableSignalLike<T> = (() => T) & { set(value: T): void };

interface CopyButtonTestAccess {
  copy(): Promise<void>;
  copied: WritableSignalLike<boolean>;
}

function asCopyButtonTestAccess(component: CopyButtonComponent): CopyButtonTestAccess {
  return component as unknown as CopyButtonTestAccess;
}

describe('CopyButtonComponent', () => {
  let fixture: ComponentFixture<CopyButtonComponent>;
  let component: CopyButtonComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CopyButtonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CopyButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('copy() with empty value returns without writing to clipboard', async () => {
    component.value = '   ';
    const writeSpy = spyOn(navigator.clipboard, 'writeText');
    await asCopyButtonTestAccess(component).copy();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(asCopyButtonTestAccess(component).copied()).toBeFalse();
  });

  it('copy() writes to clipboard and sets copied=true', fakeAsync(async () => {
    component.value = 'localhost:25565';
    spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    asCopyButtonTestAccess(component).copy();
    await Promise.resolve(); // flush microtask
    tick();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('localhost:25565');
    expect(asCopyButtonTestAccess(component).copied()).toBeTrue();
  }));

  it('copy() resets copied=false after 2 seconds', fakeAsync(async () => {
    component.value = 'test';
    spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    asCopyButtonTestAccess(component).copy();
    await Promise.resolve();
    tick();

    expect(asCopyButtonTestAccess(component).copied()).toBeTrue();
    tick(2001);
    expect(asCopyButtonTestAccess(component).copied()).toBeFalse();
  }));

  it('copy() clears the existing timeout when called again before 2 seconds', fakeAsync(async () => {
    component.value = 'test';
    spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    asCopyButtonTestAccess(component).copy();
    await Promise.resolve();
    tick();
    tick(1000); // 1 second in

    // Call again before timeout fires
    asCopyButtonTestAccess(component).copy();
    await Promise.resolve();
    tick();

    // Should still be copied, and timeout reset
    expect(asCopyButtonTestAccess(component).copied()).toBeTrue();
    tick(2001);
    expect(asCopyButtonTestAccess(component).copied()).toBeFalse();
  }));

  it('copy() handles clipboard write failure gracefully', fakeAsync(async () => {
    component.value = 'fail-value';
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('denied'));

    asCopyButtonTestAccess(component).copy();
    await Promise.resolve();
    tick();

    expect(asCopyButtonTestAccess(component).copied()).toBeFalse();
  }));

  it('ngOnDestroy clears the reset timeout', fakeAsync(async () => {
    component.value = 'test';
    spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    asCopyButtonTestAccess(component).copy();
    await Promise.resolve();
    tick();

    // Manually set a timeout to verify ngOnDestroy clears it
    const clearTimeoutSpy = spyOn(window, 'clearTimeout').and.callThrough();
    component.ngOnDestroy();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    // Drain pending timers
    tick(2001);
  }));
});
