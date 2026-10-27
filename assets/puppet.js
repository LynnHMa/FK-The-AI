import {t as i18nText} from './i18n.js';
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
export const validTexture=value=>typeof value==='string'&&value.length<=MAX_TEXTURE_LENGTH&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(value);
export function normalizeRig(value=DEFAULT_RIG) {
  if(!Array.isArray(value)||!value.length||value.length>24)throw new Error(i18nText("puppet.001"));
  const ids=new Set();
  const parts=value.map(p=>{
    if(!p||typeof p.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(p.id)||['__proto__','prototype','constructor'].includes(p.id)||ids.has(p.id))throw new Error(i18nText("puppet.002"));
    ids.add(p.id);
    const out={id:p.id,name:typeof p.name==='string'?p.name.trim().slice(0,40)||p.id:p.id,parent:p.parent??null};
    for(const [key,min,max] of [['width',6,220],['height',6,220],['x',-260,260],['y',-210,210]]) {
      if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<min||p[key]>max)throw new Error(i18nText("puppet.003"));
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
  const load=src=>new Promise(resolve=>{if(!src)return resolve(null);const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=src;});
  const rig=normalizeRig(preset.rig),skins={},sequences={};
  const avatar=await load(preset.avatar);
  await Promise.all(rig.map(async p=>{
    const image=await load(preset.textures?.[p.id]);if(image)skins[p.id]=image;
    const sequence=preset.sequences?.[p.id];
    if(sequence){const frames=await Promise.all(sequence.frames.map(load));if(frames.every(Boolean))sequences[p.id]={fps:sequence.fps,frames};}
  }));
  return {rig,avatar,skins,sequences};
}
