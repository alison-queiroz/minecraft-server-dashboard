import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ServerService, SERVER_STATUS } from './server.service';
import { environment } from '../../../environments/environment';

const JAVA_URL = environment.statusApiUrl;
const BEDROCK_URL = environment.bedrockStatusApiUrl;

const ONLINE_RESPONSE = {
  online: true,
  version: '1.21.11',
  players: { online: 3, max: 10 },
  motd: { clean: ['A Minecraft Server'] },
  software: 'Purpur',
  hostname: 'exvegan.duckdns.org',
  ip: '163.176.228.223',
  port: 25565,
  protocol: { version: 774, name: '1.21.11' },
  icon: 'data:image/png;base64,abc123',
};

const OFFLINE_RESPONSE = { online: false };

/** Helper: create service and return it alongside its httpMock. */
function createService() {
  const service = TestBed.inject(ServerService);
  const httpMock = TestBed.inject(HttpTestingController);
  return { service, httpMock };
}

describe('ServerService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  // ─── Java server ONLINE ────────────────────────────────────────────────────
  describe('when Java server is ONLINE', () => {
    let service: ServerService;

    beforeEach(() => {
      ({ service } = createService());
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock.expectOne(JAVA_URL).flush(ONLINE_RESPONSE);
      httpMock.expectOne(BEDROCK_URL).flush(OFFLINE_RESPONSE);
    });

    it('should set status to ONLINE', () => {
      expect(service.status()).toBe(SERVER_STATUS.ONLINE);
    });

    it('should populate player counts', () => {
      expect(service.onlinePlayers()).toBe(3);
      expect(service.maxPlayers()).toBe(10);
    });

    it('should populate version and software', () => {
      expect(service.version()).toBe('1.21.11');
      expect(service.software()).toBe('Purpur');
    });

    it('should populate hostname and ip', () => {
      expect(service.hostname()).toBe('exvegan.duckdns.org');
      expect(service.ip()).toBe('163.176.228.223');
    });

    it('should populate motd', () => {
      expect(service.motd()).toEqual(['A Minecraft Server']);
    });

    it('should populate protocol', () => {
      expect(service.protocol()).toEqual({ version: 774, name: '1.21.11' });
    });

  });

  // ─── Java server OFFLINE ───────────────────────────────────────────────────
  describe('when Java server is OFFLINE', () => {
    let service: ServerService;

    beforeEach(() => {
      ({ service } = createService());
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock.expectOne(JAVA_URL).flush(OFFLINE_RESPONSE);
      httpMock.expectOne(BEDROCK_URL).flush(OFFLINE_RESPONSE);
    });

    it('should set status to OFFLINE', () => {
      expect(service.status()).toBe(SERVER_STATUS.OFFLINE);
    });
  });

  // ─── Java server HTTP error ────────────────────────────────────────────────
  describe('when Java server returns an HTTP error', () => {
    let service: ServerService;

    beforeEach(() => {
      ({ service } = createService());
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock.expectOne(JAVA_URL).error(new ProgressEvent('error'));
      httpMock.expectOne(BEDROCK_URL).flush(OFFLINE_RESPONSE);
    });

    it('should set status to OFFLINE', () => {
      expect(service.status()).toBe(SERVER_STATUS.OFFLINE);
    });

    it('should zero out player counts', () => {
      expect(service.onlinePlayers()).toBe(0);
      expect(service.maxPlayers()).toBe(0);
    });
  });

  // ─── Bedrock ONLINE ────────────────────────────────────────────────────────
  describe('when Bedrock server is ONLINE', () => {
    let service: ServerService;

    const BEDROCK_ONLINE = {
      online: true,
      version: '1.21.0',
      players: { online: 1, max: 10 },
      port: 19132,
    };

    beforeEach(() => {
      ({ service } = createService());
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock.expectOne(JAVA_URL).flush(ONLINE_RESPONSE);
      httpMock.expectOne(BEDROCK_URL).flush(BEDROCK_ONLINE);
    });

    it('should set bedrockStatus to ONLINE', () => {
      expect(service.bedrockStatus()).toBe(SERVER_STATUS.ONLINE);
    });

    it('should populate bedrock player counts', () => {
      expect(service.bedrockOnlinePlayers()).toBe(1);
      expect(service.bedrockMaxPlayers()).toBe(10);
    });

    it('should populate bedrock version and port', () => {
      expect(service.bedrockVersion()).toBe('1.21.0');
      expect(service.bedrockPort()).toBe(19132);
    });
  });

  // ─── Bedrock OFFLINE ───────────────────────────────────────────────────────
  describe('when Bedrock server is OFFLINE', () => {
    let service: ServerService;

    beforeEach(() => {
      ({ service } = createService());
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock.expectOne(JAVA_URL).flush(ONLINE_RESPONSE);
      httpMock.expectOne(BEDROCK_URL).flush(OFFLINE_RESPONSE);
    });

    it('should set bedrockStatus to OFFLINE with zero counts', () => {
      expect(service.bedrockStatus()).toBe(SERVER_STATUS.OFFLINE);
      expect(service.bedrockOnlinePlayers()).toBe(0);
    });
  });

  // ─── Bedrock HTTP error ────────────────────────────────────────────────────
  describe('when Bedrock server returns an HTTP error', () => {
    let service: ServerService;

    beforeEach(() => {
      ({ service } = createService());
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock.expectOne(JAVA_URL).flush(ONLINE_RESPONSE);
      httpMock.expectOne(BEDROCK_URL).error(new ProgressEvent('error'));
    });

    it('should set bedrockStatus to OFFLINE with zero counts', () => {
      expect(service.bedrockStatus()).toBe(SERVER_STATUS.OFFLINE);
      expect(service.bedrockOnlinePlayers()).toBe(0);
    });
  });
});
