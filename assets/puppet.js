import {t as i18nText} from './i18n.js';
import {normalizeBones,resolveBoneRig} from './armature.js';
// Shared, serializable puppet model. Both the pet and arena use these dimensions.
export const DEFAULT_RIG = Object.freeze([
  {id:'torso',name:i18nText("combat.002"),x:0,y:0,width:56,height:72,parent:null},
  {id:'head',name:i18nText("combat.001"),x:0,y:-67,width:62,height:62,parent:'torso'},
  {id:'leftArm',name:i18nText("combat.003"),x:-37,y:-2,width:17,height:52,parent:'torso'},
  {id:'rightArm',name:i18nText("combat.004"),x:37,y:-2,width:17,height:52,parent:'torso'},
  {id:'leftLeg',name:i18nText("combat.005"),x:-17,y:66,width:20,height:62,parent:'torso'},
  {id:'rightLeg',name:i18nText("combat.006"),x:17,y:66,width:20,height:62,parent:'torso'}
].map(Object.freeze));
export const MAX_TEXTURE_LENGTH=1500000;
export const MAX_BUNDLE_LENGTH=32000000;
// Array order is the document's drawing order. Legacy numeric layers migrate once.
export const partsByLayer=parts=>[...parts].sort((a,b)=>(a.drawOrder??0)-(b.drawOrder??0));
export const validTexture=value=>typeof value==='string'&&value.length<=MAX_TEXTURE_LENGTH&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(value);
export function normalizeShapeMask(value){
  if(value==null)return null;
  const fail=()=>{throw new Error(i18nText('modeler.shapeError'));};
  if(!value||typeof value!=='object'||!Array.isArray(value.points)||value.points.length<3||value.points.length>256||value.inverted!==undefined&&typeof value.inverted!=='boolean')fail();
  const points=value.points.map(p=>{if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)fail();return {x:p.x,y:p.y};});
  const a=points[0],b=points.find(p=>Math.hypot(p.x-a.x,p.y-a.y)>1e-8);
  if(!b||!points.some(p=>Math.abs((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))>1e-10))fail();
  return {points,inverted:value.inverted??false};
}
// Masks use original source UVs, so rectangular crops and flips remain reversible.
export function maskDisplayPoints(p,x,y,w,h){
  const crop=p.crop??{x:0,y:0,width:1,height:1};
  return p.mask.points.map(point=>{let u=(point.x-crop.x)/crop.width,v=(point.y-crop.y)/crop.height;if(p.flipX)u=1-u;if(p.flipY)v=1-v;return {x:x+u*w,y:y+v*h};});
}
export function clipPart(c,p,x,y,w,h){
  if(!p.mask)return;
  const points=maskDisplayPoints(p,x,y,w,h);c.beginPath();c.rect(x,y,w,h);c.clip();c.beginPath();
  if(p.mask.inverted)c.rect(x,y,w,h);
  points.forEach((point,i)=>i?c.lineTo(point.x,point.y):c.moveTo(point.x,point.y));c.closePath();c.clip('evenodd');
}
export function normalizeRig(value=DEFAULT_RIG) {
  if(!Array.isArray(value)||!value.length||value.length>24)throw new Error(i18nText("puppet.001"));
  const ids=new Set();
  const legacyOrder=p=>{if(p?.layerOrder!==undefined&&(!Number.isSafeInteger(p.layerOrder)||Math.abs(p.layerOrder)>10000))throw new Error(i18nText('modeler.modelError'));return p?.layerOrder??0;};
  value.forEach(legacyOrder);
  const parts=[...value].sort((a,b)=>legacyOrder(a)-legacyOrder(b)).map(p=>{
    if(!p||typeof p.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(p.id)||['__proto__','prototype','constructor'].includes(p.id)||ids.has(p.id))throw new Error(i18nText("puppet.002"));
    ids.add(p.id);
    const out={id:p.id,name:typeof p.name==='string'?p.name.trim().slice(0,40)||p.id:p.id,parent:p.parent??null};
    out.rotation=p.rotation??0;out.opacity=p.opacity??1;out.visible=p.visible??true;out.flipX=p.flipX??false;out.flipY=p.flipY??false;out.group=p.group??null;
    if(!Number.isFinite(out.rotation)||Math.abs(out.rotation)>360||!Number.isFinite(out.opacity)||out.opacity<0||out.opacity>1||['visible','flipX','flipY'].some(k=>typeof out[k]!=='boolean')||out.group!==null&&typeof out.group!=='string')throw new Error(i18nText('modeler.modelError'));
    const crop=p.crop??{x:0,y:0,width:1,height:1};
    if(!crop||!['x','y','width','height'].every(k=>Number.isFinite(crop[k]))||crop.x<0||crop.y<0||crop.width<=0||crop.height<=0||crop.x+crop.width>1.000001||crop.y+crop.height>1.000001)throw new Error(i18nText('modeler.modelError'));
    out.crop={x:crop.x,y:crop.y,width:crop.width,height:crop.height};
    out.mask=normalizeShapeMask(p.mask);
    if(Object.hasOwn(p,'bone')){if(p.bone!==null&&typeof p.bone!=='string')throw new Error(i18nText('modeler.boneError'));out.bone=p.bone;}
    if(p.joint!=null){if(!Number.isFinite(p.joint.x)||!Number.isFinite(p.joint.y))throw new Error(i18nText('modeler.boneError'));out.joint={x:p.joint.x,y:p.joint.y};}
    for(const [key,min,max] of [['width',6,Infinity],['height',6,Infinity],['x',-Infinity,Infinity],['y',-Infinity,Infinity]]) {
      if(typeof p[key]!=='number'||!Number.isFinite(p[key])||Math.abs(p[key])>Number.MAX_SAFE_INTEGER||p[key]<min||p[key]>max)throw new Error(i18nText("puppet.003"));
      out[key]=p[key];
    }
    return out;
  });
  const byId=new Map(parts.map(p=>[p.id,p]));
  for(const p of parts) {
    const seen=new Set([p.id]);let parent=p.parent;
    while(parent!==null) {
      if(typeof parent!=='string'||!byId.has(parent)||seen.has(parent))throw new Error(i18nText("puppet.004"));
      seen.add(parent);parent=byId.get(parent).parent;
    }
  }
  return parts;
}
export function normalizeGroups(value=[],rig=[]) {
  if(!Array.isArray(value)||value.length>32)throw new Error(i18nText('modeler.groupError'));
  const ids=new Set(rig.map(p=>p.id)),groups=value.map(g=>{
    if(!g||typeof g.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(g.id)||['__proto__','prototype','constructor'].includes(g.id)||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.trim().length>40||g.visible!==undefined&&typeof g.visible!=='boolean')throw new Error(i18nText('modeler.groupError'));
    ids.add(g.id);return {id:g.id,name:g.name.trim(),parent:g.parent??null,visible:g.visible??true};
  });
  const byId=new Map(groups.map(g=>[g.id,g]));
  for(const g of groups){const seen=new Set([g.id]);let id=g.parent;while(id!==null){if(!byId.has(id)||seen.has(id))throw new Error(i18nText('modeler.groupError'));seen.add(id);id=byId.get(id).parent;}}
  if(rig.some(p=>p.group!==null&&p.group!==undefined&&!byId.has(p.group)))throw new Error(i18nText('modeler.groupError'));
  return groups;
}
export function resolvedRig(preset) {
  const rig=normalizeRig(preset.rig),groups=normalizeGroups(preset.groups,rig),byId=new Map(groups.map(g=>[g.id,g]));
  const bound=preset.bones===undefined?rig:resolveBoneRig(rig,normalizeBones(preset.bones,rig));
  return bound.map(p=>{let visible=p.visible,id=p.group;while(id){const g=byId.get(id);visible&&=g.visible;id=g.parent;}return {...p,visible};});
}
// Reuse the exact source crop / flips in editor, browser combat and native Worker.
export function drawPartImage(c,image,p,x,y,w,h,applyMask=true) {
  const crop=p.crop??{x:0,y:0,width:1,height:1};
  c.save();if(applyMask)clipPart(c,p,x,y,w,h);c.translate(x+w/2,y+h/2);c.scale(p.flipX?-1:1,p.flipY?-1:1);
  c.drawImage(image,crop.x*image.width,crop.y*image.height,crop.width*image.width,crop.height*image.height,-w/2,-h/2,w,h);c.restore();
}
export function normalizeSequences(value={},rig=DEFAULT_RIG) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(i18nText("puppet.005"));
  const out={};let total=0;
  for(const [id,sequence] of Object.entries(value)) {
    if(!rig.some(p=>p.id===id))throw new Error(i18nText("puppet.006"));
    if(sequence===null)continue;
    if(!sequence||!Array.isArray(sequence.frames)||!sequence.frames.length||sequence.frames.length>24||!sequence.frames.every(validTexture))throw new Error(i18nText("puppet.007"));
    if(!Number.isFinite(sequence.fps)||sequence.fps<1||sequence.fps>30)throw new Error(i18nText("puppet.008"));
    total+=sequence.frames.reduce((n,s)=>n+s.length,0);
    if(total>20000000)throw new Error(i18nText("puppet.009"));
    out[id]={frames:[...sequence.frames],fps:sequence.fps};
  }
  return out;
}
export function frameAt(skins,sequences,id,time) {
  const sequence=sequences[id];
  return sequence?.frames?.length?sequence.frames[Math.floor(time*sequence.fps)%sequence.frames.length]:skins[id];
}
export async function loadPuppetImages(preset) {
  const load=src=>new Promise(resolve=>{if(!src)return resolve(null);const img=new Image();img.onload=()=>{
    // Chromium's source-rect drawImage stretches SVGs with only a viewBox.
    // Rasterize once with the destination-only overload before cropping them.
    if(src.startsWith('data:image/svg')){const surface=document.createElement('canvas');surface.width=512;surface.height=Math.max(1,Math.round(512*img.naturalHeight/img.naturalWidth));surface.getContext('2d').drawImage(img,0,0,surface.width,surface.height);resolve(surface);}else resolve(img);
  };img.onerror=()=>resolve(null);img.src=src;});
  const rig=resolvedRig(preset),skins={},sequences={};
  const avatar=await load(preset.avatar);
  await Promise.all(rig.map(async p=>{
    const image=await load(preset.textures?.[p.id]);if(image)skins[p.id]=image;
    const sequence=preset.sequences?.[p.id];
    if(sequence){const frames=await Promise.all(sequence.frames.map(load));if(frames.every(Boolean))sequences[p.id]={fps:sequence.fps,frames};}
  }));
  return {rig,avatar,skins,sequences};
}
