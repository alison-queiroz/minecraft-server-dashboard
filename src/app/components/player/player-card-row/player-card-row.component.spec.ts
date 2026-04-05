import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { PlayerCardRowComponent } from './player-card-row.component';
import { PlayerService } from '../../../services/player/player.service';
import { Player } from '../../../services/player/player.model';

class MockPlayerService {
  fetchAvatarIfNeeded(_url: string): void {
    // no-op for unit tests
  }
}

describe('PlayerCardRowComponent', () => {
  let fixture: ComponentFixture<PlayerCardRowComponent>;
  const player = new Player({
    name: 'Steve',
    uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
    level: 20,
    health: 18,
    dimension: 'Overworld',
    pos: [0, 64, 0],
    last_seen: 'now',
    skin_url: 'https://textures.minecraft.net/texture/raw',
    advancement_count: 42,
    play_hours: 10,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerCardRowComponent],
      providers: [{ provide: PlayerService, useClass: MockPlayerService }],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerCardRowComponent);
    fixture.componentRef.setInput('player', player);
    fixture.detectChanges();
  });

  it('emits selected when row is clicked', () => {
    spyOn(fixture.componentInstance.selected, 'emit');

    (fixture.nativeElement as HTMLElement).click();

    expect(fixture.componentInstance.selected.emit).toHaveBeenCalledTimes(1);
  });
});
