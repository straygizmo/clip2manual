import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ja from '../shared/i18n/locales/ja.json';
import en from '../shared/i18n/locales/en.json';

// OSロケール（preload で同期解決された値）から ja/en を決定する。
// 既定は日本語。未対応ロケールは英語にフォールバック。
function resolveLanguage(raw: string): 'ja' | 'en' {
  const lower = (raw || 'ja').toLowerCase();
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('en')) return 'en';
  return 'ja';
}

const lng = resolveLanguage(window.api?.locale ?? 'ja');

void i18n.use(initReactI18next).init({
  lng,
  fallbackLng: 'ja',
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  interpolation: { escapeValue: false },
  initAsync: false,
});

// <html lang> をアクセシビリティ用に確定言語へ合わせる（index.html は ja で固定）。
if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.lang = lng;
}

export default i18n;
