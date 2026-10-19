import { t, useLanguage, localeName } from './i18n';
import React from 'react';
import type {OnlineInfo,ProductCandidate} from '../shared/contracts';
export function ProductFacts({product}:{product:OnlineInfo|ProductCandidate}){
  useLanguage();
 const evidence=product.categoryEvidence;
 if(!evidence&&!product.titleAliases?.length)return null;
 return <details className="product-facts"><summary>{t("查看名称与分类依据")}</summary>{product.titleAliases?.length?<p>{t("官方名称：")}{[product.title,...product.titleAliases].filter(Boolean).join(' ／ ')}</p>:null}{product.author?<p>{t("作者：")}{[product.author,...(product.authorAliases||[])].join(' ／ ')}</p>:null}{evidence?<><p>{t("BOOTH 本商品分类：")}{evidence.rawCategory} → {product.category?t(product.category):''}</p><p title={evidence.sourceUrl}>{t("商品")}{" "}{evidence.itemId} {" "}{t("· 规则")}{" "}{evidence.ruleVersion}</p></>:null}</details>;
}
