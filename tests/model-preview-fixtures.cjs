const {deflateSync}=require('node:zlib');
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function purplePng(){const chunk=(type,data)=>{const name=Buffer.from(type),head=Buffer.alloc(4),crc=Buffer.alloc(4);head.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([head,name,data,crc])};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(4);ihdr.writeUInt32BE(4,4);ihdr[8]=8;ihdr[9]=6;const rows=Buffer.alloc(4*17);for(let y=0;y<4;y++)for(let x=0;x<4;x++)Buffer.from([160,92,217,255]).copy(rows,y*17+1+x*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])}
const obj='mtllib Materials/purple.mtl\no TexturedSquare\nv -1 0 0\nv 1 0 0\nv 1 2 0\nv -1 2 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvn 0 0 1\nusemtl Purple\nf 1/1/1 2/2/1 3/3/1\nf 1/1/1 3/3/1 4/4/1\n';
const mtl='newmtl Purple\nKa 0 0 0\nKd 1 1 1\nKs 0 0 0\nd 1\nillum 1\nmap_Kd ../Textures/purple.png\n';
const fbx=`; FBX 7.4.0 project file
FBXHeaderExtension:  {
 FBXHeaderVersion: 1003
 FBXVersion: 7400
}
GlobalSettings:  {
 Version: 1000
 Properties70:  {
  P: "UpAxis", "int", "Integer", "",1
  P: "UpAxisSign", "int", "Integer", "",1
  P: "FrontAxis", "int", "Integer", "",2
  P: "FrontAxisSign", "int", "Integer", "",-1
  P: "CoordAxis", "int", "Integer", "",0
  P: "CoordAxisSign", "int", "Integer", "",1
  P: "UnitScaleFactor", "double", "Number", "",100
 }
}
Objects:  {
 Geometry: 1000, "Geometry::Triangle", "Mesh" {
  Vertices: *9 {
   a: -1,0,0,1,0,0,0,2,0
  }
  PolygonVertexIndex: *3 {
   a: 0,1,-3
  }
  LayerElementNormal: 0 {
   Version: 101
   Name: ""
   MappingInformationType: "ByPolygonVertex"
   ReferenceInformationType: "Direct"
   Normals: *9 {
    a: 0,0,1,0,0,1,0,0,1
   }
  }
  LayerElementMaterial: 0 {
   Version: 101
   Name: ""
   MappingInformationType: "AllSame"
   ReferenceInformationType: "IndexToDirect"
   Materials: *1 {
    a: 0
   }
  }
 }
 Model: 2000, "Model::Triangle", "Mesh" {
  Version: 232
  Properties70:  {
   P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
   P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
   P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
  }
  Shading: T
  Culling: "CullingOff"
 }
 Material: 3000, "Material::Purple", "" {
  Version: 102
  ShadingModel: "phong"
  MultiLayer: 0
  Properties70:  {
   P: "DiffuseColor", "Color", "", "A",0.63,0.36,0.85
   P: "DiffuseFactor", "Number", "", "A",1
   P: "SpecularColor", "Color", "", "A",0,0,0
   P: "Opacity", "Number", "", "A",1
  }
 }
}
Connections:  {
 C: "OO",1000,2000
 C: "OO",3000,2000
 C: "OO",2000,0
}
`;
// FBX's ASCII parser uses tabs to denote nesting.
const asciiFbx=fbx.replace(/^( +)/gm,spaces=>'\t'.repeat(spaces.length));
module.exports={asciiFbx,obj,mtl,purplePng};
