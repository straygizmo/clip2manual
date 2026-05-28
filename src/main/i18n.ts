import i18next, { type i18n as I18n, type TOptions } from 'i18next';
import ja from '../shared/i18n/locales/ja.json';
import en from '../shared/i18n/locales/en.json';

// createInstance を使い、renderer 側の i18next とは独立した辞書を持たせる。
// 既定言語は日本語（spec: 日本語=既定）。main エントリで OS ロケールに応じて
// setMainLanguage() で切り替える。テストでは初期化なしでも日本語で t() できる。
const instance: I18n = i18next.createInstance();

void instance.init({
  lng: 'ja',
  fallbackLng: 'ja',
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  interpolation: { escapeValue: false },
  initAsync: false,
});

/** app.whenReady 後に OS ロケールから言語を確定する。 */
export function setMainLanguage(raw: string): void {
  const lower = (raw || 'ja').toLowerCase();
  const lng = lower.startsWith('en') ? 'en' : 'ja';
  void instance.changeLanguage(lng);
}

/** main プロセス側の翻訳ヘルパ。 */
export function tMain(key: string, options?: TOptions): string {
  return instance.t(key, options) as string;
}
