import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import type { AdvancementsResult } from './advancements.service';
import { AdvancementsService } from './advancements.service';

describe('AdvancementsService', () => {
  let service: AdvancementsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AdvancementsService,
      ],
    });
    service = TestBed.inject(AdvancementsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getAdvancements()', () => {
    it('returns advancements from the API', () => {
      const mockResult: AdvancementsResult = {
        completed: [{ id: 'minecraft:story/mine_stone', label: 'Getting Wood', category: 'story' }],
        total: 10,
        by_category: { story: ['minecraft:story/mine_stone'] },
      };
      let result: AdvancementsResult | undefined;

      service.getAdvancements('uuid-123').subscribe(r => (result = r));
      httpMock.expectOne('/api/advancements/uuid-123').flush(mockResult);

      expect(result).toEqual(mockResult);
    });

    it('returns empty result when the API errors', () => {
      let result: AdvancementsResult | undefined;

      service.getAdvancements('uuid-123').subscribe(r => (result = r));
      httpMock.expectOne('/api/advancements/uuid-123').error(new ProgressEvent('error'));

      expect(result).toEqual({ completed: [], total: 0, by_category: {} });
    });
  });

  describe('getDescription()', () => {
    const advId = 'minecraft:story/mine_stone';

    it('fetches description from the API', () => {
      let result: string | undefined;

      service.getDescription(advId).subscribe(r => (result = r));
      httpMock
        .expectOne(req => req.url === '/api/advancements/description' && req.params.get('id') === advId)
        .flush({ description: 'Mine stone with a pickaxe' });

      expect(result).toBe('Mine stone with a pickaxe');
    });

    it('returns cached description on second call without HTTP request', () => {
      // First call — populates cache
      service.getDescription(advId).subscribe();
      httpMock
        .expectOne(req => req.url === '/api/advancements/description')
        .flush({ description: 'Mine stone with a pickaxe' });

      // Second call — should hit cache
      let result: string | undefined;
      service.getDescription(advId).subscribe(r => (result = r));
      httpMock.expectNone(req => req.url === '/api/advancements/description');

      expect(result).toBe('Mine stone with a pickaxe');
    });

    it('returns empty string when the API errors', () => {
      let result: string | undefined;

      service.getDescription('bad-id').subscribe(r => (result = r));
      httpMock
        .expectOne(req => req.url === '/api/advancements/description')
        .error(new ProgressEvent('error'));

      expect(result).toBe('');
    });
  });
});
