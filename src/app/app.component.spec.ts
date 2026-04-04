import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { AppComponent } from './app.component';

@Component({ standalone: true, template: '' })
class BlankComponent {}

describe('AppComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: BlankComponent },
          { path: 'server', component: BlankComponent },
          { path: 'players', component: BlankComponent },
          { path: 'profile', component: BlankComponent },
          { path: 'map', component: BlankComponent },
          { path: 'backups', component: BlankComponent },
          { path: 'analytics', component: BlankComponent },
        ]),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.match(() => true);
    httpMock.verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render nav, router outlet, and footer', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-nav')).toBeTruthy();
    expect(el.querySelector('router-outlet')).toBeTruthy();
    expect(el.querySelector('app-footer')).toBeTruthy();
  });

  it('updates drag and animation state from directive output handlers', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = fixture.componentInstance as unknown as {
      onDragXChange(value: number): void;
      onDraggingChange(value: boolean): void;
      onNavigateDirection(direction: 'left' | 'right'): void;
      dragX: () => number;
      isDragging: () => boolean;
      enterFrom: () => 'left' | 'right' | null;
    };

    comp.onDragXChange(42);
    comp.onDraggingChange(true);
    comp.onNavigateDirection('right');

    expect(comp.dragX()).toBe(0);
    expect(comp.isDragging()).toBeTrue();
    expect(comp.enterFrom()).toBe('right');
  });
});
