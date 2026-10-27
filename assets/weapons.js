import {t as i18nText} from './i18n.js';
import {normalizeGraph,graphRecipe,migrateLegacyWeapon} from './weapon-graph.js';
export const WEAPONS = Object.freeze({
  fist:      { get name(){return i18nText("weapons.001");}, get hint(){return i18nText("weapons.002");}, damage: 12, force: 320, interval: .16, color: '#e5d2b5' },
  grab:      { get name(){return i18nText("weapons.003");}, get hint(){return i18nText("weapons.004");}, damage: 20, force: 380, interval: .25, color: '#c7c5bf' },
  blade:     { get name(){return i18nText("weapons.005");}, get hint(){return i18nText("weapons.006");}, damage: 30, force: 140, interval: .12, color: '#c0e6ed' },
  chainsaw:  { get name(){return i18nText("weapons.007");}, get hint(){return i18nText("weapons.008");}, damage: 8, force: 60, interval: .075, color: '#e6b764' },
  hammer:    { get name(){return i18nText("weapons.009");}, get hint(){return i18nText("weapons.010");}, damage: 55, force: 550, interval: .65, color: '#e2a17b' },
  shock:     { get name(){return i18nText("weapons.011");}, get hint(){return i18nText("weapons.012");}, damage: 6, force: 85, interval: .11, color: '#b5aedf' },
  shred:     { get name(){return i18nText("weapons.013");}, get hint(){return i18nText("weapons.014");}, damage: 65, force: 480, interval: .3, color: '#df9c9c' },
  blackhole: { get name(){return i18nText("weapons.015");}, get hint(){return i18nText("weapons.016");}, damage: 90, force: 700, interval: .85, color: '#bcacd9' },
  pistol:    { get name(){return i18nText("weapons.017");}, gun: true, get hint(){return i18nText("weapons.018");}, damage: 27, force: 360, interval: .2, color: '#f2cf8d' },
  smg:       { get name(){return i18nText("weapons.019");}, gun: true, get hint(){return i18nText("weapons.020");}, damage: 9, force: 150, interval: .075, color: '#f0c17a' },
  shotgun:   { get name(){return i18nText("weapons.021");}, gun: true, get hint(){return i18nText("weapons.022");}, damage: 16, force: 220, interval: .7, color: '#eba17b' },
  railgun:   { get name(){return i18nText("weapons.023");}, gun: true, get hint(){return i18nText("weapons.024");}, damage: 160, force: 1800, interval: .8, color: '#a6e1de' },
  swear:     { get name(){return i18nText("weapons.025");}, get hint(){return i18nText("weapons.026");}, damage: 5, force: 170, interval: .12, color: '#ff5d7a' }
});
export const WEAPON_KEYS = Object.freeze(['1','2','3','4','5','6','7','8','9','0','-','=','\\']);


export const CUSTOM_ID=/^custom_[a-zA-Z0-9_-]{1,64}$/;
export function normalizeWeapon(value,strict=false){
 if(!value||typeof value.id!=='string'||!CUSTOM_ID.test(value.id)){if(strict)throw new Error(i18nText("weapons.027"));return null;}
 let graph=value.graph;
 if(!graph&&Object.hasOwn(WEAPONS,value.behavior))graph=migrateLegacyWeapon(value);
 graph=normalizeGraph(graph,strict);if(!graph)return null;
 const damage=graph.nodes.find(n=>n.type==='effect'&&n.params.kind==='damage')?.params.amount||0;
 const force=graph.nodes.find(n=>n.type==='effect'&&n.params.kind==='impulse')?.params.force||0;
 const trigger=graph.nodes.find(n=>n.type==='trigger'),appearance=graph.nodes.find(n=>['projectile','beam','area','visual'].includes(n.type));
 return {version:2,id:value.id,name:typeof value.name==='string'&&value.name.trim()?value.name.trim().slice(0,40):i18nText("weapons.028"),behavior:'graph',damage,force,interval:trigger?.params.interval||.2,color:appearance?.params.color||'#9acaff',graph};
}
export function normalizeWeapons(value){const seen=new Set();return (Array.isArray(value)?value:[]).slice(0,48).map(v=>normalizeWeapon(v)).filter(w=>w&&!seen.has(w.id)&&seen.add(w.id));}
export function weaponCatalog(settings={}){return {...WEAPONS,...Object.fromEntries(normalizeWeapons(settings.customWeapons).map(w=>[w.id,{...w,gun:false,hint:i18nText("weapons.029")+w.graph.nodes.length+i18nText("weapons.030")+w.graph.links.length+i18nText("weapons.031")}]))};}
export function exportWeapons(weapons){return {format:'fk-weapons',version:2,weapons:normalizeWeapons(weapons)};}
export function importWeapons(bundle){
 if(!bundle||bundle.format!=='fk-weapons'||![1,2].includes(bundle.version)||!Array.isArray(bundle.weapons)||!bundle.weapons.length||bundle.weapons.length>48)throw new Error(i18nText("weapons.032"));
 const ids=new Set();return bundle.weapons.map(value=>{const w=normalizeWeapon(value,true);if(ids.has(w.id))throw new Error(i18nText("weapons.033"));ids.add(w.id);return w;});
}
export function newGraphWeapon(id,recipe='blank',name=i18nText("weapons.034")){return normalizeWeapon({id,name,graph:graphRecipe(recipe)});}
