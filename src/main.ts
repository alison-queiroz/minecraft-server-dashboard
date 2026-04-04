import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { PreloadAllModules, provideRouter, withPreloading } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { isDevMode } from '@angular/core';
import { AppComponent } from './app/app.component';
import { authGuard } from './app/guards/auth.guard';
import { authInterceptor } from './app/interceptors/auth.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideRouter([
      {
        path: 'login',
        loadComponent: () =>
          import('./app/pages/login/login.component').then(
            (m) => m.LoginComponent,
          ),
      },
      {
        path: '',
        loadComponent: () =>
          import('./app/pages/home/home.component').then(
            (m) => m.HomeComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'server',
        loadComponent: () =>
          import('./app/pages/server-status/server-status.component').then(
            (m) => m.ServerStatusComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'players',
        loadComponent: () =>
          import('./app/pages/players/players.component').then(
            (m) => m.PlayersComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./app/pages/profile/profile.component').then(
            (m) => m.ProfileComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'map',
        loadComponent: () =>
          import('./app/pages/map/map.component').then(
            (m) => m.MapComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'backups',
        loadComponent: () =>
          import('./app/pages/backup-list/backup-list.component').then(
            (m) => m.BackupListComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./app/pages/analytics/analytics.component').then(
            (m) => m.AnalyticsComponent,
          ),
        canActivate: [authGuard],
      },
      { path: '**', redirectTo: '' },
    ], withPreloading(PreloadAllModules)),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
}).catch((err) => console.error(err));
