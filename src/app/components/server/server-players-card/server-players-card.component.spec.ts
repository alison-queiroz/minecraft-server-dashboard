import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ServerPlayersCardComponent } from './server-players-card.component';
import { ServerService } from '../../../services/server/server.service';

const serverState = {
  maxPlayers: signal(20),
  onlinePlayers: signal(5),
};

const mockServerService = {
  maxPlayers: () => serverState.maxPlayers(),
  onlinePlayers: () => serverState.onlinePlayers(),
};

describe('ServerPlayersCardComponent', () => {
  let fixture: ComponentFixture<ServerPlayersCardComponent>;
  let component: ServerPlayersCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServerPlayersCardComponent],
      providers: [
        { provide: ServerService, useValue: mockServerService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ServerPlayersCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('computes playersPercent when maxPlayers is greater than 0', () => {
    serverState.maxPlayers.set(20);
    serverState.onlinePlayers.set(5);
    expect(component.playersPercent()).toBe(25);
  });

  it('returns 0 when maxPlayers is 0', () => {
    serverState.maxPlayers.set(0);
    serverState.onlinePlayers.set(5);
    expect(component.playersPercent()).toBe(0);
  });
});
