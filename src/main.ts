import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { HomeComponent } from './app/pages/home/home.component';
import { ServerStatusComponent } from './app/pages/server-status/server-status.component';
import { PlayersComponent } from './app/pages/players/players.component';
import { LoginComponent } from './app/pages/login/login.component';
import { authGuard } from './app/guards/auth.guard';
import { authInterceptor } from './app/interceptors/auth.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter([
      { path: 'login', component: LoginComponent },
      { path: '', component: HomeComponent, canActivate: [authGuard] },
      { path: 'server', component: ServerStatusComponent, canActivate: [authGuard] },
      { path: 'players', component: PlayersComponent, canActivate: [authGuard] },
      { path: '**', redirectTo: '' },
    ]),
  ]
}).catch(err => console.error(err));
