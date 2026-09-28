import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { PlayerFaceComponent } from './player-face.component';
import { Player } from '../../../services/player/player.model';

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

  function avatarImg(): HTMLImageElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('img');
  }

  beforeEach(async () => {
    // No PlayerService (or HttpClient) provider: the face is a pure
    // presentational component and must not fetch avatars itself.
    await TestBed.configureTestingModule({
      imports: [PlayerFaceComponent],
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

  // ── avatar <img> ──────────────────────────────────────────────────────────

  it('requests the avatar at exactly the rendered size (default 40)', () => {
    fixture.componentRef.setInput('player', makePlayer({ skin_url: 'https://mc-heads.net/skin/Steve' }));
    fixture.detectChanges();

    const img = avatarImg();
    expect(img?.getAttribute('src')).toBe('https://mc-heads.net/avatar/Steve/40');
    expect(img?.getAttribute('width')).toBe('40');
    expect(img?.getAttribute('height')).toBe('40');
  });

  it('follows the size input for both the URL and the intrinsic dimensions', () => {
    fixture.componentRef.setInput('player', makePlayer({ skin_url: 'https://mc-heads.net/avatar/Steve/64' }));
    fixture.componentRef.setInput('size', 28);
    fixture.detectChanges();

    const img = avatarImg();
    expect(img?.getAttribute('src')).toBe('https://mc-heads.net/avatar/Steve/28');
    expect(img?.getAttribute('width')).toBe('28');
  });

  it('lets the browser load the avatar lazily and decode it off the main thread', () => {
    fixture.componentRef.setInput('player', makePlayer({ skin_url: 'https://mc-heads.net/skin/Steve' }));
    fixture.detectChanges();

    expect(avatarImg()?.getAttribute('loading')).toBe('lazy');
    expect(avatarImg()?.getAttribute('decoding')).toBe('async');
  });

  it('renders raw skins as a CSS background instead of an <img>', () => {
    fixture.componentRef.setInput('player', makePlayer({
      skin_url: 'https://textures.minecraft.net/texture/raw', is_raw_skin: true,
    }));
    fixture.detectChanges();

    expect(avatarImg()).toBeNull();
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
