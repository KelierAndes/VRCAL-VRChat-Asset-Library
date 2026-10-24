const PACKAGES=/\.(?:zip|rar|7z|unitypackage)$/i;
const IMAGES=['png','jpg','jpeg','webp','gif','bmp'];
const key=(name:string)=>name.normalize('NFKC').toLowerCase();
const coverSuffix=/[ _.-]+(?:cover|preview(?:image)?|thumbnail|封面|预览|サムネイル)$/i;

export interface ScanCoverPairs {
  previews:Map<string,string>;
  companions:Set<string>;
  owners:Map<string,string[]>;
}

/** Names from one already-authorized directory listing; never reads a path. */
export function pairScanCovers(names:readonly string[]):ScanCoverPairs {
  const files=[...new Set(names)].filter(name=>name&&!/[\\/:\x00]/.test(name));
  const packages=files.filter(name=>PACKAGES.test(name)).map(name=>({name,stem:name.replace(PACKAGES,'')}));
  const previews=new Map<string,string>(),companions=new Set<string>(),owners=new Map<string,string[]>();
  const stems=new Map<string,typeof packages>(),fullNames=new Map<string,typeof packages>();
  for(const file of packages){for(const [index,value] of [[stems,file.stem],[fullNames,file.name]] as const){const group=index.get(key(value))??[];group.push(file);index.set(key(value),group)}}
  const chosen=new Map<string,{name:string;evidence:number;format:number}>();
  for(const name of files){
    const match=/\.([^.]+)$/.exec(name),format=IMAGES.indexOf(match?.[1].toLowerCase()??'');if(format<0)continue;
    const stem=name.slice(0,-match![0].length),identity=key(stem);
    let targets=[...(stems.get(identity)??[]),...(fullNames.get(identity)??[])],evidence=stems.has(identity)?0:1;
    if(!targets.length){const plain=identity.replace(coverSuffix,'');if(plain===identity||!plain)continue;targets=[...(stems.get(plain)??[]),...(fullNames.get(plain)??[])];evidence=2}
    targets=[...new Set(targets)];if(!targets.length)continue;
    // Different original stems that collapse under normalization are distinct
    // products. A package-qualified filename must not bridge another stem.
    const families=new Set(targets.map(target=>target.stem));if(families.size!==1)continue;
    const family=stems.get(key(targets[0].stem))??[];if(new Set(family.map(target=>target.stem)).size!==1)continue;
    companions.add(name);owners.set(name,targets.map(target=>target.name));
    for(const target of targets){
      const previous=chosen.get(target.name),candidate={name,evidence,format};
      if(!previous||evidence<previous.evidence||evidence===previous.evidence&&(format<previous.format||format===previous.format&&name<previous.name))chosen.set(target.name,candidate);
    }
  }
  for(const [name,cover] of chosen)previews.set(name,cover.name);
  return {previews,companions,owners};
}
