import '@angular/compiler';
import '@analogjs/vitest-angular/setup-serializers';
import '@analogjs/vitest-angular/setup-snapshots';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { afterEach, vi } from 'vitest';

interface TouchInitLike {
  identifier?: number;
  target: EventTarget;
  clientX?: number;
  clientY?: number;
  screenX?: number;
  screenY?: number;
  pageX?: number;
  pageY?: number;
}

setupTestBed();

declare global {
  const jest: typeof vi;
}

Object.defineProperty(globalThis, 'jest', {
  value: vi,
  configurable: true,
});

if (typeof globalThis.Response === 'undefined') {
  class MockResponse {}
  globalThis.Response = MockResponse as unknown as typeof Response;
}

if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = (() => Promise.resolve(new globalThis.Response())) as typeof fetch;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class MockResizeObserver {
    observe(): void {
      return undefined;
    }

    unobserve(): void {
      return undefined;
    }

    disconnect(): void {
      return undefined;
    }
  }

  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

if (typeof globalThis.Touch === 'undefined') {
  class MockTouch {
    identifier: number;
    target: EventTarget;
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
    pageX: number;
    pageY: number;

    constructor(props: TouchInitLike) {
      this.identifier = props.identifier ?? 0;
      this.target = props.target;
      this.clientX = props.clientX ?? 0;
      this.clientY = props.clientY ?? 0;
      this.screenX = props.screenX ?? 0;
      this.screenY = props.screenY ?? 0;
      this.pageX = props.pageX ?? 0;
      this.pageY = props.pageY ?? 0;
    }
  }

  globalThis.Touch = MockTouch as unknown as typeof Touch;
}

if (!('clipboard' in navigator)) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (_value: string): Promise<void> => Promise.resolve(),
      readText: (): Promise<string> => Promise.resolve(''),
    },
  });
}

if (!URL.createObjectURL) {
  let blobCounter = 0;
  URL.createObjectURL = ((_blob: Blob | MediaSource) => `blob:mock-${blobCounter++}`) as typeof URL.createObjectURL;
}

if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
}

afterEach(() => {
  vi.useRealTimers();
});
