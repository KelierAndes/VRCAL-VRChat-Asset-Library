import React from 'react';
import type {OnlineInfo,ProductCandidate} from '../shared/contracts';
export function ProductFacts({product}:{product:OnlineInfo|ProductCandidate}){
 const evidence=product.categoryEvidence;
 if(!evidence&&!product.titleAliases?.length)return null;
 return <details className="product-facts"><summary>查看名称与分类依据</summary>{product.titleAliases?.length?<p>官方名称：{[product.title,...product.titleAliases].filter(Boolean).join(' ／ ')}</p>:null}{product.author?<p>作者：{[product.author,...(product.authorAliases||[])].join(' ／ ')}</p>:null}{evidence?<><p>BOOTH 本商品分类：{evidence.rawCategory} → {product.category}</p><p title={evidence.sourceUrl}>商品 {evidence.itemId} · 规则 {evidence.ruleVersion}</p></>:null}</details>;
}
