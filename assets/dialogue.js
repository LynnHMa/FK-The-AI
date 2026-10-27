import {t as i18nText} from './i18n.js';
export function normalizeDialogue(value={}){
 const presets=(Array.isArray(value?.presets)?value.presets:[{id:'default',name:i18nText("dialogue.001"),lines:[i18nText("dialogue.002"),i18nText("dialogue.003"),i18nText("dialogue.004")]}]).slice(0,24).filter(p=>p&&typeof p.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)).map(p=>({id:p.id,name:String(p.name||i18nText("dialogue_editor.020")).slice(0,40),lines:(Array.isArray(p.lines)?p.lines:[]).filter(x=>typeof x==='string'&&x.trim()).slice(0,100).map(x=>x.trim().slice(0,80))}));
 const seen=new Set();const unique=presets.filter(p=>!seen.has(p.id)&&seen.add(p.id));
 const number=(key,min,max,fallback)=>Number.isFinite(value?.[key])?Math.max(min,Math.min(max,value[key])):fallback;
 return {enabled:value?.enabled!==false,mode:value?.mode==='random'?'random':'sequential',active:unique.some(p=>p.id===value?.active)?value.active:unique[0]?.id||'',cooldown:number('cooldown',.3,30,1.8),duration:number('duration',.5,15,3),presets:unique};
}
export function createDialogue(getSettings,random=Math.random){
 let cursor=0,preset='',owner='',last=-Infinity,bubble=null;
 return {
 setOwner(id){if(owner===id)return;owner=id;cursor=0;preset='';last=-Infinity;bubble=null;},
 hit(now){const s=getSettings();if(!s.enabled||now-last<s.cooldown)return null;const p=s.presets.find(p=>p.id===s.active);if(!p?.lines.length)return null;if(preset!==p.id){preset=p.id;cursor=0;}const index=s.mode==='random'?Math.min(p.lines.length-1,Math.floor(random()*p.lines.length)):cursor++%p.lines.length;last=now;bubble={text:p.lines[index],until:now+s.duration};return {...bubble};},
 current(now){return getSettings().enabled&&bubble&&now<bubble.until?{...bubble}:null;},
 exportState(now){return {owner,cursor,preset,remaining:Math.max(0,(bubble?.until||0)-now),text:bubble?.text||'',cooldown:Math.max(0,getSettings().cooldown-(now-last))};},
 importState(s,now){if(!s||typeof s!=='object')return;if(typeof s.owner==='string')owner=s.owner.slice(0,80);cursor=Number.isSafeInteger(s.cursor)&&s.cursor>=0?s.cursor:0;preset=typeof s.preset==='string'?s.preset.slice(0,80):'';last=now-getSettings().cooldown+Math.max(0,Math.min(30,Number(s.cooldown)||0));bubble=typeof s.text==='string'?{text:s.text.slice(0,80),until:now+Math.max(0,Math.min(15,Number(s.remaining)||0))}:null;}
 };
}
