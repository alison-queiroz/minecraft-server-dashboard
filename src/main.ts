import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { HomeComponent } from './app/pages/home/home.component';
import { ServerStatusComponent } from './app/pages/server-status/server-status.component';
import { PlayersComponent } from './app/pages/players/players.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideRouter([
      { path: '', component: HomeComponent },
      { path: 'server', component: ServerStatusComponent },
      { path: 'players', component: PlayersComponent },
      { path: '**', redirectTo: '' },
    ]),
  ]
}).catch(err => console.error(err));
