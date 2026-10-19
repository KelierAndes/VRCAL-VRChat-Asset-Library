import React, { useState, useSyncExternalStore } from 'react';
import { LANGUAGE_IDS, type AppLanguage } from '../shared/contracts';
import { normalizeLanguage, translate } from '../shared/i18n';

// The locale is independent of workspace/query state. Switching it rerenders
// existing components, preserving drafts, selection and the review session.
let language: AppLanguage = normalizeLanguage(typeof window === 'undefined' ? undefined : window.library?.initialLanguage);
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setLanguage(value: unknown) {
  const next = normalizeLanguage(value);
  if (typeof document !== 'undefined') { document.documentElement.lang = next; document.documentElement.dataset.language = next; }
  if (language === next) return;
  language = next;
  listeners.forEach(listener => listener());
}
export function useLanguage() { return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage); }
export function t(source: string, values: Record<string, string | number> = {}) { return translate(source, language, values); }
export function localeName() { return language === 'ja' ? 'ja-JP' : language === 'en' ? 'en-US' : 'zh-CN'; }

const names: Record<AppLanguage, string> = { 'zh-CN': '中文', ja: '日本語', en: 'English' };
export function LanguageSwitcher({ onChange, compact = false }: { onChange: (value: AppLanguage) => Promise<unknown>; compact?: boolean }) {
  const selected = useLanguage();
  const [saving, setSaving] = useState(false);
  return <label className={`language-switch${compact ? ' compact' : ''}`}><span>{t('语言')}</span><select data-language-selector={compact ? 'header' : 'settings'} aria-label={t('界面语言')} value={selected} disabled={saving} onChange={async event => {
    const next = normalizeLanguage(event.currentTarget.value);
    setSaving(true); setLanguage(next);
    try { if (await onChange(next) === false) setLanguage(selected); } catch (error) { setLanguage(selected); throw error; } finally { setSaving(false); }
  }}>{LANGUAGE_IDS.map(value => <option key={value} value={value} lang={value}>{names[value]}</option>)}</select></label>;
}
export function LanguageSettings({ onChange }: { onChange: (value: AppLanguage) => Promise<unknown> }) {
  useLanguage();
  return <section className="setting-block language-settings"><h3>{t('界面语言')}</h3><p>{t('切换后立即生效，重启后仍会保留。')}</p><LanguageSwitcher onChange={onChange}/></section>;
}
