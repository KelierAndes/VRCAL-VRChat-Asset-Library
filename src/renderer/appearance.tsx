import { useState } from 'react';
import type { AppTheme } from '../shared/contracts';

const themes = [
  { id: 'nasa', name: 'NASA 朋克', note: '航天设备面板 · 暖灰机壳 · 复古铭牌', preview: { kicker: 'STOW 84S / LOCAL ARCHIVE', title: 'ASSET SYSTEM', footer: '▰ ▰ ▰ ▰' } },
  { id: 'swiss', name: '瑞士国际主义', note: '十二栏网格 · 大字排版 · 黑白红', preview: { kicker: '01 / LOCAL ARCHIVE', title: 'Collected.', footer: '2026 / VRC' } },
  { id: 'x', name: 'X 暗色', note: '纯黑底色 · 清晰边线 · 蓝色重点', preview: { kicker: 'VRC 素材库', title: '你的素材。', footer: '原素材只读 · 本地整理' } }
] as const satisfies readonly { id: AppTheme; name: string; note: string; preview: { kicker: string; title: string; footer: string } }[];

export function ThemeIdentity() {
  return <div className="theme-identity" aria-hidden="true">
    <span className="theme-kicker">PERSONAL CREATIVE ARCHIVE</span>
    <strong className="theme-wordmark"><span className="theme-wordmark-nasa">STOW 84S<br/>ASSET SYSTEM</span><span className="theme-wordmark-swiss">Objects.<br/>Collected.</span></strong>
    <span className="theme-subtitle">VRC / LOCAL LIBRARY</span>
    <div className="theme-band"><span/><span/><span/><span/></div>
  </div>;
}

export function ThemeStation({ module }: { module: string }) {
  return <div className="theme-station" aria-hidden="true"><span className="module-id">{module}</span><span className="module-title">PERSONAL ARCHIVE / THIS SIDE UP</span><span className="theme-annotation">确认来源，再开始创作。</span></div>;
}

export function ThemeFooter() {
  return <footer className="theme-footer"><span aria-hidden="true">{new Date().getFullYear()} / LOCAL</span><span>原素材只读</span><span>整理信息独立保存</span></footer>;
}

export function ThemeSwitcher({ value, onChange }: { value: AppTheme; onChange: (theme: AppTheme) => Promise<unknown> }) {
  const [saving, setSaving] = useState(false);
  return <label className="theme-switch"><span>界面主题</span><select aria-label="界面主题" value={value} disabled={saving} onChange={async event => {
    const next = event.target.value as AppTheme;
    setSaving(true);
    try { await onChange(next); } finally { setSaving(false); }
  }}>{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>;
}

export function ThemeSettings({ value, onChange }: { value: AppTheme; onChange: (theme: AppTheme) => Promise<unknown> }) {
  const [saving, setSaving] = useState(false);
  return <section className="setting-block theme-settings" aria-label="主题设置"><h3>界面主题</h3><p>选择适合你的版式，重启后仍会保留。</p><div className="theme-options">
    {themes.map(theme => <button key={theme.id} type="button" className="theme-option" aria-label={`使用${theme.name}主题`} aria-pressed={value === theme.id} disabled={saving} onClick={async () => {
      if (value === theme.id) return;
      setSaving(true);
      try { await onChange(theme.id); } finally { setSaving(false); }
    }}><div className={`theme-preview theme-preview-${theme.id}`} aria-hidden="true"><span>{theme.preview.kicker}</span><strong>{theme.preview.title}</strong><small>{theme.preview.footer}</small></div><div className="theme-option-copy"><strong>{theme.name}{value === theme.id ? ' · 已选择' : ''}</strong><span>{theme.note}</span></div></button>)}
  </div></section>;
}
