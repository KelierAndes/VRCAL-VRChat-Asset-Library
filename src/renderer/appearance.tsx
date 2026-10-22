import { t, useLanguage, localeName } from './i18n';
import { useState } from 'react';
import type { AppTheme } from '../shared/contracts';

const themes = [
  { id: 'nasa', name: 'NASA 朋克', note: '航天设备面板 · 暖灰机壳 · 复古铭牌', preview: { kicker: 'STOW 84S / LOCAL ARCHIVE', title: 'ASSET SYSTEM', footer: '▰ ▰ ▰ ▰' } },
  { id: 'swiss', name: '瑞士国际主义', note: '十二栏网格 · 大字排版 · 黑白红', preview: { kicker: '01 / LOCAL ARCHIVE', title: 'Collected.', footer: '2026 / VRC' } },
  { id: 'x', name: 'X 暗色', note: '纯黑底色 · 清晰边线 · 蓝色重点', preview: { kicker: 'VRC 素材库', title: '你的素材。', footer: '扫描与补全只读 · 本地整理' } },
  { id: 'x-light', name: 'X 浅色', note: '纯白底色 · 轻盈边线 · 蓝色重点', preview: { kicker: 'VRC 素材库', title: '你的素材。', footer: '扫描与补全只读 · 本地整理' } }
] as const satisfies readonly { id: AppTheme; name: string; note: string; preview: { kicker: string; title: string; footer: string } }[];

export function ThemeIdentity() {
  useLanguage();
  return <div className="theme-identity" aria-hidden="true">
    <span className="theme-kicker">PERSONAL CREATIVE ARCHIVE</span>
    <strong className="theme-wordmark"><span className="theme-wordmark-nasa">STOW 84S<br/>ASSET SYSTEM</span><span className="theme-wordmark-swiss">Objects.<br/>Collected.</span></strong>
    <span className="theme-subtitle">VRC / LOCAL LIBRARY</span>
    <div className="theme-band"><span/><span/><span/><span/></div>
  </div>;
}

export function ThemeStation({ module }: { module: string }) {
  useLanguage();
  return <div className="theme-station" aria-hidden="true"><span className="module-id">{module}</span><span className="module-title">PERSONAL ARCHIVE / THIS SIDE UP</span><span className="theme-annotation">{t("确认来源，再开始创作。")}</span></div>;
}

export function ThemeFooter() {
  useLanguage();
  return <footer className="theme-footer"><span aria-hidden="true">{new Date().getFullYear()} / LOCAL</span><span>{t("扫描与补全只读")}</span><span>{t("整理信息独立保存")}</span></footer>;
}

export function ThemeSwitcher({ value, onChange }: { value: AppTheme; onChange: (theme: AppTheme) => Promise<unknown> }) {
  useLanguage();
  const [saving, setSaving] = useState(false);
  return <label className="theme-switch"><span>{t("界面主题")}</span><select aria-label={t("界面主题")} value={value} disabled={saving} onChange={async event => {
    const next = event.target.value as AppTheme;
    setSaving(true);
    try { await onChange(next); } finally { setSaving(false); }
  }}>{themes.map(theme => <option key={theme.id} value={theme.id}>{t(theme.name)}</option>)}</select></label>;
}

export function ThemeSettings({ value, onChange }: { value: AppTheme; onChange: (theme: AppTheme) => Promise<unknown> }) {
  useLanguage();
  const [saving, setSaving] = useState(false);
  return <section className="setting-block theme-settings" aria-label={t("主题设置")}><h3>{t("界面主题")}</h3><p>{t("选择适合你的版式，重启后仍会保留。")}</p><div className="theme-options">
    {themes.map(theme => <button key={theme.id} type="button" className="theme-option" aria-label={t("使用{v0}主题", {v0: t(theme.name)})} aria-pressed={value === theme.id} disabled={saving} onClick={async () => {
      if (value === theme.id) return;
      setSaving(true);
      try { await onChange(theme.id); } finally { setSaving(false); }
    }}><div className={`theme-preview theme-preview-${theme.id}`} aria-hidden="true"><span>{t(theme.preview.kicker)}</span><strong>{t(theme.preview.title)}</strong><small>{t(theme.preview.footer)}</small></div><div className="theme-option-copy"><strong>{t(theme.name)}{value === theme.id ? t(" · 已选择") : ''}</strong><span>{t(theme.note)}</span></div></button>)}
  </div></section>;
}
