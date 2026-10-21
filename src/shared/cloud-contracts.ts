export interface CloudFile {id?:string;name:string;path:string;directory:boolean;size?:number;modifiedAt?:string;productId?:string;seenAt?:string}
export interface CloudCapture {accountKey:string;directoryPath:string;items:CloudFile[];capturedAt:string;complete:false;source:'web-visible';warnings:string[]}
export interface CloudStoredFile extends CloudFile {key:string;accountKey:string;directoryPath:string;capturedAt:string}
export interface CloudCatalogData {schema:1;captures:CloudCapture[];links:{entryKey:string;localId?:string;separate?:boolean}[]}
export interface CloudRow extends CloudStoredFile {relation:'cloud-only'|'both'|'review';localIds:string[];candidates:{id:string;name:string;reason:string}[];basis:'none'|'manual'|'product-id'|'filename-size';stale:boolean;contentVerified:false}
export interface CloudPage {items:CloudRow[];total:number;directories:{accountKey:string;path:string;capturedAt:string;count:number}[];warnings:string[]}
export interface CloudQuery {search?:string;accountKey?:string;relation?:'cloud-only'|'both'|'review';offset?:number;limit?:number}
export interface StorageLocation {kind:'local'|'cloud'|'both';cloudCount:number;lastSeenAt?:string;cloudEntries:{key:string;path:string;accountKey:string;capturedAt:string;basis:string}[]}
export interface BaiduScanState {phase:'idle'|'running'|'paused'|'completed'|'stopped';rootPath:string;currentPath:string;directoriesRead:number;directoriesPending:number;filesRead:number;failedDirectories:number;failures:{path:string;reason:string}[];error?:string}
export interface BaiduState {open:boolean;connected:boolean;loading:boolean;url:string;status:string;accountKey?:string;scan?:BaiduScanState}
