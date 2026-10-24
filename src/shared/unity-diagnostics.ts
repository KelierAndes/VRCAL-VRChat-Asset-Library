export type UnityDiagnosticStatus='ready'|'missing'|'unverified'|'other-project'|'stale'|'unavailable';
export interface UnityDiagnosticIssue {
 id:string;severity:'error'|'warning';kind:'compile'|'exception'|'import'|'general';code?:string;
 message:string;detail:string;relativePath?:string;line?:number;count:number;
 firstObservedAt:number;lastObservedAt:number;suggestions:string[];
}
export interface UnityDiagnosticSnapshot {
 projectId:string;status:UnityDiagnosticStatus;message:string;checkedAt:number;sessionId?:string;
 projectVersion:string;issues:UnityDiagnosticIssue[];truncated:boolean;revision:string;
}
/** Text-only suggestions. This contract deliberately has no command or file-write operation. */
export interface UnityDiagnosticAdvice {
 summary:string;facts:string[];causes:string[];steps:string[];verification:string[];missingInformation:string[];
}
export interface UnityDiagnosticsAPI {unityDiagnostics(projectId:string):Promise<UnityDiagnosticSnapshot>}
/** UI scheduling only, not a trust/security hash. A repeated occurrence is not new evidence for another paid request. */
export function unityDiagnosticAnalysisKey(snapshot:UnityDiagnosticSnapshot):string {
 const text=JSON.stringify([snapshot.projectId,snapshot.sessionId,snapshot.projectVersion,snapshot.issues.filter(issue=>issue.severity==='error').map(issue=>[issue.id,issue.detail])]);
 let a=0x811c9dc5,b=0x9e3779b9;
 for(let index=0;index<text.length;index++){a=Math.imul(a^text.charCodeAt(index),0x01000193);b=Math.imul(b^text.charCodeAt(index),0x85ebca6b);}
 return `${(a>>>0).toString(16)}${(b>>>0).toString(16)}`;
}
