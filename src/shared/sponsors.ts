export interface SponsorLink {label:string;url:string}
export interface Sponsor {id:string;name?:string;anonymous?:boolean;avatar?:string;avatarFile?:string;note?:string;links:SponsorLink[];order?:number}
export interface SponsorsDocument {schemaVersion:1;updatedAt:string;sponsors:Sponsor[]}
export interface SponsorsState {status:'unloaded'|'cached'|'fresh'|'offline'|'error';sponsors:Sponsor[];updatedAt?:string;checkedAt?:string;message?:string}
export const SPONSORS_REFRESH_MS=300000;
