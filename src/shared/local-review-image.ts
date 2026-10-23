import type {AssetRecord} from './contracts';

// Local provenance only. Product images downloaded from a website are not
// evidence of an existing local preview, even when they share the same cache.
function cachedImage(value:unknown):value is string {
  return typeof value==='string'&&value.trim().length>0&&value!=='.'&&value!=='..'&&!/[\\/:\x00]/.test(value);
}

export function localReviewImage(asset:AssetRecord):string|undefined {
  return [asset.manual.coverFile,...(asset.members??[]).map(member=>member.manual?.coverFile),asset.previewFile].find(cachedImage);
}
