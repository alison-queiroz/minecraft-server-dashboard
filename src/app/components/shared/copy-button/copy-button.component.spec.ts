import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
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
      providers: [],
    }).compileComponents();

    fixture = TestBed.createComponent(CopyButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('copy() with empty value returns without writing to clipboard', async () => {
    component.value = '   ';
    const writeSpy = jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await asCopyButtonTestAccess(component).copy();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(asCopyButtonTestAccess(component).copied()).toBe(false);
  });

  it('copy() writes to clipboard and sets copied=true', async () => {
    component.value = 'localhost:25565';
    jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await asCopyButtonTestAccess(component).copy();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('localhost:25565');
    expect(asCopyButtonTestAccess(component).copied()).toBe(true);
  });

  it('copy() resets copied=false after 2 seconds', async () => {
    jest.useFakeTimers();
    component.value = 'test';
    jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await asCopyButtonTestAccess(component).copy();

    expect(asCopyButtonTestAccess(component).copied()).toBe(true);
    jest.advanceTimersByTime(2001);
    expect(asCopyButtonTestAccess(component).copied()).toBe(false);
  });

  it('copy() clears the existing timeout when called again before 2 seconds', async () => {
    jest.useFakeTimers();
    component.value = 'test';
    jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await asCopyButtonTestAccess(component).copy();
    jest.advanceTimersByTime(1000);

    await asCopyButtonTestAccess(component).copy();

    expect(asCopyButtonTestAccess(component).copied()).toBe(true);
    jest.advanceTimersByTime(2001);
    expect(asCopyButtonTestAccess(component).copied()).toBe(false);
  });

  it('copy() handles clipboard write failure gracefully', async () => {
    component.value = 'fail-value';
    jest.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

    await asCopyButtonTestAccess(component).copy();

    expect(asCopyButtonTestAccess(component).copied()).toBe(false);
  });

  it('ngOnDestroy clears the reset timeout', async () => {
    jest.useFakeTimers();
    component.value = 'test';
    jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await asCopyButtonTestAccess(component).copy();

    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    component.ngOnDestroy();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    jest.advanceTimersByTime(2001);
  });
});




