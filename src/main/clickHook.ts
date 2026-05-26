import { uIOhook, type UiohookMouseEvent } from 'uiohook-napi';
import { type RawClickEvent } from '../shared/clickLog';

export class ClickHook {
  private events: RawClickEvent[] = [];
  private listening = false;

  private readonly handler = (e: UiohookMouseEvent): void => {
    this.events.push({
      osX: e.x,
      osY: e.y,
      button: Number(e.button ?? 0),
      timestampMs: Date.now(),
    });
  };

  /** 録画開始時に呼ぶ。バッファをクリアしてフックを開始する。 */
  start(): void {
    if (this.listening) return;
    this.events = [];
    uIOhook.on('mousedown', this.handler);
    uIOhook.start();
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
