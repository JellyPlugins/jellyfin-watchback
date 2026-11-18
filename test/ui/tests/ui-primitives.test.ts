import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {loadSettingsBundle, saveCoverage} from '../src/loader.js';
let ui: any;
beforeEach(() => {
  delete (window as any).WatchbackUi;
  document.body.innerHTML = '<main></main>';
  loadSettingsBundle();
  ui = (window as any).WatchbackUi;
});
afterAll(saveCoverage);
describe('native panel animation lifecycle', () => {
  let hidden: ReturnType<typeof vi.spyOn>;
  let body: HTMLDivElement;
  let effects: any[];
  let motion: any;
  let trigger: HTMLElement;

  beforeEach(() => {
    hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => motion);
    trigger = document.getElementById('opener')!;
    body = document.createElement('div');
    body.style.opacity = '1';
    document.querySelector('main')!.appendChild(body);
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ height: 120 } as DOMRect);
    effects = [];
    Object.defineProperty(body, 'animate', { configurable: true, value: vi.fn(() => {
      const effect = { onfinish: null, oncancel: null, cancel: vi.fn() };
      effects.push(effect);
      return effect;
    }) });
  });

  afterEach(() => {
    ui.setExpanded(body, false, trigger, { animate: false });
    hidden.mockRestore();
  });

  const collapsed = () => ({ height: '0px', opacity: '0' });

  test('opening and closing clean up effects and defer the closed callback until completion', () => {
    const closed = vi.fn();
    ui.setExpanded(body, true, trigger, { before: collapsed(), duration: 300 });
    expect(effects).toHaveLength(1);
    expect(body.hidden).toBe(false);
    expect(body.getAttribute('aria-hidden')).toBe('false');
    expect(motion.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    effects[0].onfinish();
    expect(effects[0].cancel).toHaveBeenCalledOnce();
    expect(effects[0].onfinish).toBeNull();
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(body.hidden).toBe(false);
    ui.setExpanded(body, false, trigger, { onClosed: closed });
    expect(body.hidden).toBe(false);
    expect(body.hasAttribute('inert')).toBe(true);
    expect(closed).not.toHaveBeenCalled();
    effects[1].onfinish();
    expect(body.hidden).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
  });

  test('reversal cancels the old effect and its stale completion cannot close the replacement', () => {
    const closed = vi.fn();
    ui.setExpanded(body, false, trigger, { onClosed: closed });
    const stale = effects[0].onfinish;
    ui.setExpanded(body, true, trigger, { before: { height: '50px', opacity: '0.5' } });
    expect(effects[0].cancel).toHaveBeenCalledOnce();
    stale();
    expect(body.hidden).toBe(false);
    expect(closed).not.toHaveBeenCalled();
    effects[1].onfinish();
    expect(body.hidden).toBe(false);
  });

  test('resize retargets the open panel without resetting its original deadline', async () => {
    ui.setExpanded(body, true, trigger, { before: collapsed(), duration: 300 });
    await vi.advanceTimersByTimeAsync(100);
    vi.mocked(body.getBoundingClientRect).mockReturnValueOnce({ height: 50 } as DOMRect).mockReturnValue({ height: 180 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(effects[0].cancel).toHaveBeenCalledOnce();
    expect(body.animate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(body.animate).mock.calls[1][1]).toMatchObject({ duration: 200 });
    effects[1].onfinish();
    window.dispatchEvent(new Event('resize'));
    expect(body.animate).toHaveBeenCalledTimes(2);
  });

  test('a reduced-motion change finishes a pending collapse exactly once', async () => {
    const closed = vi.fn();
    ui.setExpanded(body, false, trigger, { duration: 300, onClosed: closed });
    const changed = motion.addEventListener.mock.calls[0][1];
    changed({ matches: false });
    expect(body.hidden).toBe(false);
    changed({ matches: true });
    expect(body.hidden).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(closed).toHaveBeenCalledOnce();
  });

  test('missing completion events fall back to the bounded timer', async () => {
    const closed = vi.fn();
    ui.setExpanded(body, false, trigger, { duration: 300, onClosed: closed });
    await vi.advanceTimersByTimeAsync(349);
    expect(body.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(body.hidden).toBe(true);
    expect(effects[0].cancel).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
  });

  test('animation failures finish safely and identical frames never create an effect', () => {
    vi.mocked(body.animate).mockImplementationOnce(() => { throw new Error('animation unavailable'); });
    const closed = vi.fn();
    ui.setExpanded(body, false, trigger, { onClosed: closed });
    expect(body.hidden).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
    ui.setExpanded(body, true, trigger, { before: { height: '120px', opacity: '1' } });
    expect(body.hidden).toBe(false);
    expect(body.animate).toHaveBeenCalledOnce();
  });
});
