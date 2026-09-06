import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { PlayerFaceComponent } from './player-face.component';
import { PlayerService } from '../../../services/player/player.service';
import { Player } from '../../../services/player/player.model';

// ---------------------------------------------------------------------------
// Mock PlayerService — avoids Firestore / HTTP setup
// ---------------------------------------------------------------------------
const mockPlayerService = {
  getAvatarUrl: (url: string) => url,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePlayer(overrides: Partial<{
  name: string;
  uuid: string;
  skin_url: string;
  is_raw_skin: boolean;
}>): Player {
  return new Player({
    name: overrides.name ?? 'Steve',
    uuid: overrides.uuid ?? 'aaaa-0001',
    level: 1,
    health: 20,
    dimension: 'Overworld',
    pos: [0, 64, 0],
    last_seen: '2026-01-01',
    skin_url: overrides.skin_url ?? '',
    is_raw_skin: overrides.is_raw_skin ?? false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PlayerFaceComponent', () => {
  let fixture: ComponentFixture<PlayerFaceComponent>;
  let component: PlayerFaceComponent;

  function getUseRawSkin(): boolean {
    return (component as unknown as { useRawSkin: () => boolean }).useRawSkin();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerFaceComponent],
      providers: [{ provide: PlayerService, useValue: mockPlayerService }],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerFaceComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.componentRef.setInput('player', makePlayer({}));
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // ── useRawSkin computed ───────────────────────────────────────────────────

  it('returns false when skin_url contains mc-heads.net/avatar/', () => {
    fixture.componentRef.setInput('player', makePlayer({
      skin_url: 'https://mc-heads.net/avatar/Steve/100',
      is_raw_skin: true,  // would otherwise return true
    }));
    fixture.detectChanges();
    expect(getUseRawSkin()).toBe(false);
  });

  it('returns the is_raw_skin value when skin_url does not contain mc-heads.net/avatar/', () => {
    fixture.componentRef.setInput('player', makePlayer({
      skin_url: 'https://mc-heads.net/skin/Steve',
      is_raw_skin: true,
    }));
    fixture.detectChanges();
    expect(getUseRawSkin()).toBe(true);
  });

  it('returns false for is_raw_skin=false with a regular skin URL', () => {
    fixture.componentRef.setInput('player', makePlayer({
      skin_url: 'https://mc-heads.net/skin/Steve',
      is_raw_skin: false,
    }));
    fixture.detectChanges();
    expect(getUseRawSkin()).toBe(false);
  });

  it('falls back to isRawAvatar() when is_raw_skin is undefined', () => {
    const p = makePlayer({ skin_url: 'https://example.com/raw.png' });
    // Bedrock players (UUID starting with 0000-0009) have isRawAvatar() = true
    fixture.componentRef.setInput('player', p);
    fixture.detectChanges();
    // Player has is_raw_skin=false and isRawAvatar()=false → useRawSkin=false
    expect(getUseRawSkin()).toBe(false);
  });

  // ── avatarSrc computed ────────────────────────────────────────────────────

  it('passes the player avatar URL to playerService.getAvatarUrl', () => {
    const getSpy = jest.spyOn(mockPlayerService, 'getAvatarUrl');
    const p = makePlayer({ skin_url: 'https://mc-heads.net/avatar/Steve/40' });
    fixture.componentRef.setInput('player', p);
    fixture.detectChanges();
    expect(getSpy).toHaveBeenCalled();
  });

  it('falls back to avatarUrl() when skin_url is empty', () => {
    const player = makePlayer({ skin_url: '' });
    player.avatarUrl = (() => 'https://fallback/avatar.png');
    fixture.componentRef.setInput('player', player);
    fixture.detectChanges();
    const rawSkinUrl = (component as unknown as { rawSkinUrl: () => string }).rawSkinUrl();
    expect(rawSkinUrl).toBe('https://fallback/avatar.png');
  });

  // ── bgPosition computed ───────────────────────────────────────────────────

  it('computes bgPosition based on size input', () => {
    fixture.componentRef.setInput('player', makePlayer({}));
    fixture.componentRef.setInput('size', 40);
    fixture.detectChanges();
    const bg = (component as unknown as { bgPosition: () => string }).bgPosition();
    expect(bg).toBe('-37px -40px');
  });

  it('uses default size of 40', () => {
    fixture.componentRef.setInput('player', makePlayer({}));
    fixture.detectChanges();
    const bg = (component as unknown as { bgPosition: () => string }).bgPosition();
    expect(bg).toBe('-37px -40px');
  });
});
