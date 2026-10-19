// Check the shipped dependency graph without falling back to the developer's node_modules.
const fs=require('node:fs'),path=require('node:path'),asar=require('@electron/asar');
function verifyRuntimeDependencies(archiveFile){
 const files=new Set(asar.listPackage(archiveFile).map(file=>file.replaceAll('\\','/').replace(/^\//,'')));
 const read=file=>JSON.parse(asar.extractFile(archiveFile,path.normalize(file)).toString('utf8'));
 const root=read('package.json');
 if(!root.main||!files.has(root.main.replaceAll('\\','/').replace(/^\.\//,'')))throw Error('Packaged main entry is missing.');
 const manifests=['package.json',...[...files].filter(file=>/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file))],missing=[];
 for(const file of manifests){
  const manifest=read(file),optional=manifest.optionalDependencies||{};
  for(const dependency of Object.keys(manifest.dependencies||{})){
   if(Object.hasOwn(optional,dependency))continue;
   let folder=path.posix.dirname(file),found=false;
   while(true){
    const candidate=path.posix.join(folder,'node_modules',dependency,'package.json');
    if(files.has(candidate)){found=true;break}
    if(folder==='.')break;
    folder=path.posix.dirname(folder);
   }
   if(!found)missing.push((manifest.name||file)+' -> '+dependency);
  }
 }
 if(missing.length)throw Error('Packaged runtime dependencies missing: '+missing.join(', '));
 return {packages:manifests.length-1,version:root.version};
}
module.exports={verifyRuntimeDependencies};
if(require.main===module){try{const archive=path.resolve(process.argv[2]||'../build-stage/win-unpacked/resources/app.asar');if(!fs.statSync(archive).isFile())throw Error('Expected app.asar file.');const result=verifyRuntimeDependencies(archive);console.log('Runtime package verified: '+result.packages+' packages; version '+result.version)}catch(error){console.error(error.message);process.exitCode=1}}
