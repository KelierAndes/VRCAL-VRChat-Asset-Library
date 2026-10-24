import type {ProductCandidate} from './contracts';
export type DiscoveryPlatform='booth'|'xianyu';
export interface DiscoveryRequest {description:string;avatar?:string;platforms:DiscoveryPlatform[]}
export interface DiscoveryPlan {summary:string;boothQueries:string[];xianyuQuery:string;terms:string[]}
export interface DiscoveryProduct extends ProductCandidate {platform:DiscoveryPlatform;searchQuery:string;matchedTerms:string[];avatarNote:string}
export interface DiscoveryState {running:boolean;request?:DiscoveryRequest;plan?:DiscoveryPlan;method?:'ai'|'local'|'web-ai';notice:string;products:DiscoveryProduct[];sources:Partial<Record<DiscoveryPlatform,string>>;finishedAt?:number}
export interface DiscoveryAiRecord {searchId:string;suggestion:DiscoveryPlan;provenance:import('./ai-contracts').AiProvenance}
