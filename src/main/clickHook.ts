import { uIOhook, type UiohookMouseEvent } from 'uiohook-napi';
import { type RawClickEvent } from '../shared/clickLog';

/**
 * Global mouse-down capture during a recording.
 *
 * NOTE: `uIOhook` is a process-global singleton, so only ONE ClickHook may be
 * active at a time. The caller (ipc.ts) enforces this via a single module-level
 * instance that is recreated only after the previous recording has stopped.
 */
export class ClickHook {
  private events: RawClickEvent[] = [];
  private listening = false;

  private readonly handler = (e: UiohookMouseEvent): void => {
    this.events.push({
      osX: e.x,
      osY: e.y,
      button: Number(e.button ?? 0), // uiohook: 1=left 2=right 3=middle; 0 if unknown
      timestampMs: Date.now(),
    });
  };

  /** 録画開始時に呼ぶ。バッファをクリアしてフックを開始する。 */
  start(): void {
    if (this.listening) return;
    this.events = [];
    uIOhook.on('mousedown', this.handler);
    try {
      uIOhook.start();
    } catch (err) {
      uIOhook.off('mousedown', this.handler);
      throw err;
    }
    this.listening = true;
  }

  /** 録画停止時に呼ぶ。フックを止め、収集した生イベントを返す。 */
  stop(): RawClickEvent[] {
    if (this.listening) {
      uIOhook.off('mousedown', this.handler);
      uIOhook.stop();
      this.listening = false;
    }
    return this.events;
  }
}
