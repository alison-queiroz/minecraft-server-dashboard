import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { isDevMode, provideZonelessChangeDetection } from '@angular/core';
import { AppComponent } from './app/app.component';
import { authGuard } from './app/guards/auth.guard';
import { authInterceptor } from './app/interceptors/auth.interceptor';
import { loadingInterceptor } from './app/interceptors/loading.interceptor';
import { ngswBypassInterceptor } from './app/interceptors/ngsw-bypass.interceptor';

const pageTitle = (page: string): string => `${page} · EV Minecraft Server`;

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch(), withInterceptors([loadingInterceptor, authInterceptor, ngswBypassInterceptor])),
    provideRouter([
      {
        path: 'login',
        title: pageTitle('Sign in'),
        loadComponent: () =>
          import('./app/pages/login/login.component').then(
            (m) => m.LoginComponent,
          ),
      },
      {
        path: '',
        title: pageTitle('Home'),
        loadComponent: () =>
          import('./app/pages/home/home.component').then(
            (m) => m.HomeComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'players',
        title: pageTitle('Players'),
        loadComponent: () =>
          import('./app/pages/players/players.component').then(
            (m) => m.PlayersComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'profile',
        title: pageTitle('Profile'),
        loadComponent: () =>
          import('./app/pages/profile/profile.component').then(
            (m) => m.ProfileComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'map',
        title: pageTitle('World Map'),
        loadComponent: () =>
          import('./app/pages/map/map.component').then(
            (m) => m.MapComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'backups',
        title: pageTitle('Backups'),
        loadComponent: () =>
          import('./app/pages/backup-list/backup-list.component').then(
            (m) => m.BackupListComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'analytics',
        title: pageTitle('Analytics'),
        loadComponent: () =>
          import('./app/pages/analytics/analytics.component').then(
            (m) => m.AnalyticsComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'services',
        title: pageTitle('Services'),
        loadComponent: () =>
          import('./app/pages/services/services.component').then(
            (m) => m.ServicesComponent,
          ),
        canActivate: [authGuard],
      },
      { path: '**', redirectTo: '' },
    ]),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
}).catch((err) => console.error(err));
