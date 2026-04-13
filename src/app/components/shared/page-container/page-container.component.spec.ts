import type { ComponentFixture } from '@angular/core/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageContainerComponent } from './page-container.component';

@Component({
  standalone: true,
  imports: [PageContainerComponent],
  template: `<app-page-container><span class="child">content</span></app-page-container>`,
})
class HostComponent {}

describe('PageContainerComponent', () => {
  let fixture: ComponentFixture<PageContainerComponent>;
  let component: PageContainerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageContainerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PageContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('host element has max-w-7xl class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('max-w-7xl')).toBe(true);
  });

  it('host element has mx-auto class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('mx-auto')).toBe(true);
  });

  it('host element has w-full class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('w-full')).toBe(true);
  });

  it('host element has pb-6 class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('pb-6')).toBe(true);
  });

});

describe('PageContainerComponent — ng-content projection', () => {
  it('projects nested content', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    const hostFixture = TestBed.createComponent(HostComponent);
    hostFixture.detectChanges();
    const child = (hostFixture.nativeElement as HTMLElement).querySelector('.child');
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe('content');
  });
});
