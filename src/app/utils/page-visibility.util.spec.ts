import { pageVisible$ } from './page-visibility.util';

describe('pageVisible$', () => {
  let state: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    state = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  function change(next: DocumentVisibilityState): void {
    state = next;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('emits the current visibility, then each distinct change', () => {
    const seen: boolean[] = [];
    const sub = pageVisible$(document).subscribe(v => seen.push(v));

    change('hidden');
    change('hidden');
    change('visible');
    sub.unsubscribe();
    change('hidden');

    expect(seen).toEqual([true, false, true]);
  });

  it('starts with false when subscribed from a hidden tab', () => {
    state = 'hidden';
    const seen: boolean[] = [];
    pageVisible$(document).subscribe(v => seen.push(v)).unsubscribe();

    expect(seen).toEqual([false]);
  });
});
