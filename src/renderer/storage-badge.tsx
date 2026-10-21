import React from 'react';
import type {StorageLocation} from '../shared/cloud-contracts';
import {t,useLanguage} from './i18n';
export function StorageBadge({storage}:{storage?:StorageLocation}){useLanguage();if(!storage||!storage.cloudCount)return null;return <span className={`storage-badge storage-${storage.kind}`} title={t('云端记录仅代表曾读取到商品或文件线索，不保证版本及内容相同。')}>{storage.kind==='both'?t('云端与本地'):t('仅云端记录')}</span>}
