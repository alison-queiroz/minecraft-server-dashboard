import { MAP_BASE_URL, joinMapUrl, normaliseMapHash } from './map-hash.util';
import { environment } from '../../environments/environment';

describe('map-hash.util', () => {
  it('normaliseMapHash extracts the hash from a full map URL', () => {
    expect(normaliseMapHash('https://map.example.com/#world:1:2:3')).toBe('#world:1:2:3');
  });

  it('normaliseMapHash prefixes a bare fragment with #', () => {
    expect(normaliseMapHash('#world:1:2:3')).toBe('#world:1:2:3');
    expect(normaliseMapHash('not a url')).toBe('#not a url');
  });

  it('MAP_BASE_URL comes from the environment', () => {
    expect(MAP_BASE_URL).toBe(environment.mapBaseUrl);
  });

  it('joinMapUrl inserts the slash only when the base lacks one', () => {
    expect(joinMapUrl('https://map.example.com', '#w:0:0:0')).toBe('https://map.example.com/#w:0:0:0');
    expect(joinMapUrl('https://map.example.com/', '#w:0:0:0')).toBe('https://map.example.com/#w:0:0:0');
    expect(joinMapUrl('/map', '?_r=1#w')).toBe('/map/?_r=1#w');
  });
});
