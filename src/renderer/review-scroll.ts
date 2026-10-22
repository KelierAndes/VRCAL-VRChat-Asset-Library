// The comparison rows keep the same DOM and session when the header is pinned.
// Only the element that owns vertical scrolling changes.
export function reviewScroller(list:HTMLElement|null):HTMLElement|null {
  if(!list)return null;
  return list.closest<HTMLElement>('.review-header-unpinned')??
    (getComputedStyle(list).overflowY==='visible'?list.closest<HTMLElement>('.review-page'):list);
}

export interface ReviewViewport {top:number;id?:string;offset?:number}

export function captureReviewViewport(workspace:HTMLElement|null):ReviewViewport|undefined {
  const node=reviewScroller(workspace?.querySelector<HTMLElement>('.review-list')??null);
  if(!node)return;
  const bounds=node.getBoundingClientRect();
  const row=[...node.querySelectorAll<HTMLElement>('.review-row')].find(row=>{
    const rect=row.getBoundingClientRect();return rect.bottom>bounds.top+1&&rect.top<bounds.bottom;
  });
  return {top:node.scrollTop,...(row?{id:row.dataset.assetId,offset:row.getBoundingClientRect().top-bounds.top}:{})};
}

export function restoreReviewViewport(workspace:HTMLElement|null,saved:ReviewViewport):void {
  const node=reviewScroller(workspace?.querySelector<HTMLElement>('.review-list')??null);
  if(!node)return;
  const row=[...node.querySelectorAll<HTMLElement>('.review-row')].find(row=>row.dataset.assetId===saved.id);
  node.scrollTop=row&&saved.offset!==undefined?
    node.scrollTop+row.getBoundingClientRect().top-node.getBoundingClientRect().top-saved.offset:saved.top;
}
