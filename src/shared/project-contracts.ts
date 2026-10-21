export interface ProjectImportOptions {maSetup?:boolean;maAssemble?:boolean}
export interface MASetupStatus {state:'waiting-import'|'waiting-selection'|'applied'|'skipped'|'error';message:string;avatarName?:string;prefabPath?:string;menuName?:string;requestPublished?:boolean;prefabPaths?:string[];assembly?:boolean;hierarchyPath?:string}
export type ProjectFileKind='directory'|'prefab'|'model'|'texture'|'material'|'animation'|'script'|'other';
export interface ProjectFile {name:string;relativePath:string;directory:boolean;kind:ProjectFileKind;size:number}
export interface ProjectFilePage {projectId:string;relativePath:string;entries:ProjectFile[];total:number;offset:number;hasMore:boolean;truncated:boolean;warnings:string[];projectVersion:string;packages:{name:string;version:string}[]}
export interface ImportSourceChoice {id:string;name:string;path:string;mode:'copy'|'unitypackage';warning?:string}
export interface GuidConflict {guid:string;source:string;target:string}
export interface ProjectImportPreview {token:string;assetId:string;projectId:string;sourceName:string;sourcePath:string;projectPath:string;mode:'copy'|'unitypackage';fileCount:number;bytes:number;ready:boolean;conflicts:GuidConflict[];warnings:string[];projectVersion:string;editorPath?:string;helperRequired:boolean;maSetup?:boolean;maAssemble?:boolean}
export type ProjectImportState='copying'|'waiting-unity'|'importing'|'completed'|'cancelled'|'failed';
export interface ProjectChanges {basis:'before-after'|'time-window';checkedAt:string;complete:boolean;total:number;paths:{path:string;kind:'added'|'modified'|'recent'}[]}
export interface ProjectImportJob {id:string;assetId:string;projectId:string;sourceName:string;sourcePath:string;projectPath:string;mode:'copy'|'unitypackage';state:ProjectImportState;createdAt:string;finishedAt?:string;destinationPath?:string;destinationContainer?:string;fileCount:number;completedFiles:number;bytes:number;copiedBytes:number;sha256?:string;message?:string;linked?:boolean;maSetup?:MASetupStatus;importedAssetPaths?:string[];importedPathsComplete?:boolean;importLocations?:string[];comparisonReady?:boolean;projectChanges?:ProjectChanges;changeLocations?:string[]}
