import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { PlayerCardRowComponent } from './player-card-row.component';
import { Player } from '../../../services/player/player.model';

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

  const mcHeadsPlayer = new Player({
    name: 'Alex',
    uuid: 'bbbbbbbb-0000-0000-0000-000000000002',
    level: 5,
    health: 20,
    dimension: 'Overworld',
    pos: [0, 64, 0],
    last_seen: 'now',
    skin_url: 'https://mc-heads.net/skin/Alex',
    is_raw_skin: false,
  });

  beforeEach(async () => {
    // No PlayerService / HttpClient: the row must not prefetch avatars.
    await TestBed.configureTestingModule({
      imports: [PlayerCardRowComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerCardRowComponent);
    fixture.componentRef.setInput('player', player);
    fixture.detectChanges();
  });

  it('emits selected when row is clicked', () => {
    jest.spyOn(fixture.componentInstance.selected, 'emit');

    (fixture.nativeElement as HTMLElement).click();

    expect(fixture.componentInstance.selected.emit).toHaveBeenCalledTimes(1);
  });

  it('shows an mc-heads face as one lazy <img> at the 40px row size (no /64 prefetch)', () => {
    const f = TestBed.createComponent(PlayerCardRowComponent);
    f.componentRef.setInput('player', mcHeadsPlayer);
    f.detectChanges();

    const imgs = (f.nativeElement as HTMLElement).querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0]?.getAttribute('src')).toBe('https://mc-heads.net/avatar/Alex/40');
    expect(imgs[0]?.getAttribute('loading')).toBe('lazy');
  });
});
