import type {AssetRecord} from './contracts';
export interface ProjectProductEvidence {kind:'directory'|'filename-id'|'readme-link'|'catalog-name'|'import-record';relativePath:string;value?:string}
export interface ProjectProduct {
 key:string;name:string;paths:string[];hintUrls:string[];localNameHints:string[];
 evidence:ProjectProductEvidence[];asset?:AssetRecord;state:'identified'|'clue'|'ambiguous'|'pending'|'manual';
}
export interface ProjectProductPage {projectId:string;items:ProjectProduct[];scannedAt:string;inspectedEntries:number;truncated:boolean;warnings:string[];onlineEnabled?:boolean}
export interface ProjectProductRegistration {asset:AssetRecord;queued:boolean}
