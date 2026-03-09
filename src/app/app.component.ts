import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { PlayerService } from './services/player/player.service';
import { HeaderComponent } from './components/header/header.component';
import { FooterComponent } from './components/footer/footer.component';
import { PlayerListComponent } from './components/player-list/player-list.component';
import { PlayerDetailComponent } from './components/player-detail/player-detail.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeaderComponent, FooterComponent, PlayerListComponent, PlayerDetailComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  private readonly playerService = inject(PlayerService);

  ngOnInit() {
    this.playerService.fetchPlayerData();
    setInterval(() => this.playerService.fetchPlayerData(), 30000);
  }
}
