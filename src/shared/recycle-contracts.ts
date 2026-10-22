export interface AssetRecycleResult {
 cancelled:boolean;
 results:{path:string;assetIds:string[];status:'recycled'|'failed'|'not-run';error?:string}[];
}
