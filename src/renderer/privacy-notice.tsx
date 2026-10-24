import React from 'react';
import {INBOX_POLICY_VERSION,INBOX_POLICY_SECTIONS} from '../shared/inbox-policy';
import {t,useLanguage} from './i18n';
export function PrivacyNotice(){useLanguage();return <details className="inbox-privacy" data-policy-version={INBOX_POLICY_VERSION}><summary>{t('使用协议与隐私说明')}</summary><p>{INBOX_POLICY_VERSION}</p>{INBOX_POLICY_SECTIONS.map(section=><section key={section.title}><h4>{t(section.title)}</h4><p>{t(section.text)}</p></section>)}<p>{t('完整文档随程序附带：docs/USER_AGREEMENT.zh-CN.md、docs/PRIVACY.zh-CN.md。')}</p></details>}
