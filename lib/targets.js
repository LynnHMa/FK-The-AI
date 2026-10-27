import {t as i18nText,h as i18nHtml} from '../assets/i18n.js';
import { validTexture } from '../assets/combat.js';
import { randomUUID } from 'node:crypto';
import { normalizeRig, normalizeSequences, MAX_BUNDLE_LENGTH } from '../assets/puppet.js';
import {normalizeDialogue} from '../assets/dialogue.js';

export const DEFAULT_AI = Object.freeze({id:'default_ai',name:i18nText("client.002"),avatar:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#292925"/><text x="50" y="59" text-anchor="middle" font-family="monospace" font-size="30" fill="#cec1a6">${i18nHtml("targets.001")}</text></svg>`)});

export function migrateTargets(config={}) {
  let presets=Array.isArray(config.presets)?config.presets.map(p=>({...p})):[{...DEFAULT_AI}];
  if(!(config.targetSchemaVersion>=2)) {
    presets=presets.filter(p=>!['runaway_boss','clown_pm'].includes(p.id));
    if(!presets.some(p=>p.id==='default_ai'))presets.unshift({...DEFAULT_AI});
    presets=presets.map(p=>p.id==='default_ai'?{...p,name:i18nText("client.002")}:p);
    // Older uploads only saved the active avatar; recover it as a preset.
    if(config.activeTarget?.id?.startsWith('custom_')&&!presets.some(p=>p.id===config.activeTarget.id))presets.push({...config.activeTarget});
  }
  presets=presets.map(p=>({...p,dialogue:normalizeDialogue(p.dialogue??config.combatSettings?.dialogue)}));
  const activeTarget=presets.find(p=>p.id===config.activeTarget?.id)||presets[0]||null;
  return {presets,activeTarget,targetSchemaVersion:3};
}
export function addTarget(config,input) {
  const name=typeof input?.name==='string'?input.name.trim():'';
  if(!name||name.length>60)throw new Error(i18nText("targets.002"));
  const avatar=input.avatar||'';
  if(typeof avatar!=='string'||avatar.length>1500000||(avatar&&avatar!==DEFAULT_AI.avatar&&!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(avatar)))throw new Error(i18nText("targets.003"));
  if(config.presets.length>=64)throw new Error(i18nText("targets.004"));
  const target={id:'custom_'+randomUUID(),name,avatar,dialogue:normalizeDialogue(input.dialogue)};
  return {...config,presets:[...config.presets,target],activeTarget:target,targetSchemaVersion:3};
}
export function deleteTarget(config,id) {
  if(typeof id!=='string'||!config.presets.some(p=>p.id===id))throw new Error(i18nText("index.009"));
  const presets=config.presets.filter(p=>p.id!==id);
  return {...config,presets,activeTarget:config.activeTarget?.id===id?(presets[0]||null):config.activeTarget,targetSchemaVersion:3};
}

export function updateTarget(config,input) {
  const original=config.presets.find(p=>p.id===input?.id);
  if(!original)throw new Error(i18nText("index.009"));
  const target={...original,textures:{...original.textures}};
  if(Object.hasOwn(input,'dialogue'))target.dialogue=normalizeDialogue(input.dialogue);
  if(Object.hasOwn(input,'rig'))target.rig=normalizeRig(input.rig);
  const rig=normalizeRig(target.rig);
  // Removed parts cannot keep orphan textures or animation data.
  target.textures=Object.fromEntries(Object.entries(target.textures).filter(([id])=>rig.some(p=>p.id===id)));
  if(Object.hasOwn(input,'sequences'))target.sequences=normalizeSequences(input.sequences,rig);
  else if(target.sequences)target.sequences=normalizeSequences(Object.fromEntries(Object.entries(target.sequences).filter(([id])=>rig.some(p=>p.id===id))),rig);
  if(Object.hasOwn(input,'name')) {
    if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>60)throw new Error(i18nText("targets.002"));
    target.name=input.name.trim();
  }
  if(Object.hasOwn(input,'textures')) {
    if(!input.textures||typeof input.textures!=='object'||Array.isArray(input.textures))throw new Error(i18nText("targets.005"));
    for(const [part,image] of Object.entries(input.textures)) {
      if(!rig.some(p=>p.id===part))throw new Error(i18nText("targets.006"));
      if(image===null||image==='')delete target.textures[part];
      else {if(!validTexture(image))throw new Error(i18nText("targets.007"));target.textures[part]=image;}
    }
  }
  if(JSON.stringify(target).length>24000000)throw new Error(i18nText("targets.008"));
  return {...config,presets:config.presets.map(p=>p.id===target.id?target:p),activeTarget:config.activeTarget?.id===target.id?target:config.activeTarget};
}

// Validate the entire bundle before returning anything to the persistence layer.
export function importTargets(config,input) {
  if(input?.version!==1||!Array.isArray(input.presets)||!input.presets.length||input.presets.length+config.presets.length>64||JSON.stringify(input).length>MAX_BUNDLE_LENGTH)throw new Error(i18nText("targets.009"));
  let next={...config,presets:[...config.presets]};const ids=new Map();
  for(const source of input.presets) {
    next=addTarget(next,{name:source.name,avatar:source.avatar,dialogue:source.dialogue});
    const id=next.activeTarget.id;ids.set(source.id,id);
    next=updateTarget(next,{id,...(source.rig?{rig:source.rig}:{}),...(source.textures?{textures:source.textures}:{}),...(source.sequences?{sequences:source.sequences}:{})});
  }
  next.activeTarget=next.presets.find(p=>p.id===ids.get(input.activeTarget))||next.activeTarget;
  return next;
}
