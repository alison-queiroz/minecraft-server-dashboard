import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { authGuard } from './app/guards/auth.guard';
import { authInterceptor } from './app/interceptors/auth.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
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
      { path: '**', redirectTo: '' },
    ]),
  ],
}).catch((err) => console.error(err));
