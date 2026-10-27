import {t as i18nText} from './i18n.js';
// Shared by persistence, DOM and Canvas. Only validated color tokens reach CSS.
const variant=(bg,surface,stage,text,accent)=>Object.freeze({bg,surface,stage,text,accent});
export const THEMES=Object.freeze({
  graphite:{get name(){return i18nText("themes.001");},dark:variant('#161615','#20201e','#141413','#ece3d1','#c4ac82'),light:variant('#f4f2ed','#ffffff','#eae7df','#302d27','#806139')},
  ocean:{get name(){return i18nText("themes.002");},dark:variant('#101923','#182635','#0c1520','#e1edf8','#78bafa'),light:variant('#eef4fb','#ffffff','#e5eef8','#20354d','#2569ae')},
  forest:{get name(){return i18nText("themes.003");},dark:variant('#121d19','#1c2c24','#0f1914','#e0ede5','#8bc4a3'),light:variant('#eef5ef','#ffffff','#e4eee5','#253e2c','#367451')},
  violet:{get name(){return i18nText("themes.004");},dark:variant('#1a1623','#282133','#15111e','#ece5f6','#b7a0ef'),light:variant('#f4f0fa','#ffffff','#ece5f5','#3c2d50','#7951aa')},
  rose:{get name(){return i18nText("themes.005");},dark:variant('#21171c','#31232b','#1b1217','#f5e4eb','#e5a0b7'),light:variant('#fbf0f3','#ffffff','#f3e5ea','#4b2d38','#ab4568')},
  amber:{get name(){return i18nText("themes.006");},dark:variant('#211a12','#30271c','#1a150e','#f4e9d8','#e8b666'),light:variant('#faf4e9','#fffdf8','#f0e7d7','#483622','#946018')}
});
export const THEME_COLOR_KEYS=Object.freeze({get accent(){return i18nText("themes.007");},get bg(){return i18nText("themes.008");},get surface(){return i18nText("themes.009");},get stage(){return i18nText("client.122");},get text(){return i18nText("weapon_graph.054");}});
export function normalizeTheme(value) {
  const out={palette:'graphite',mode:'dark',customEnabled:false,custom:{dark:{},light:{}}};
  if(!value||typeof value!=='object')return out;
  if(Object.hasOwn(THEMES,value.palette))out.palette=value.palette;
  if(['dark','light','system'].includes(value.mode))out.mode=value.mode;
  out.customEnabled=value.customEnabled===true;
  for(const mode of ['dark','light'])for(const key of Object.keys(THEME_COLOR_KEYS)) {
    const color=value.custom?.[mode]?.[key];
    if(typeof color==='string'&&/^#[a-f0-9]{6}$/i.test(color))out.custom[mode][key]=color.toLowerCase();
  }
  return out;
}
const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
export function resolveTheme(value,prefersDark=true) {
  const theme=normalizeTheme(value),mode=theme.mode==='system'?(prefersDark?'dark':'light'):theme.mode;
  const colors={...THEMES[theme.palette][mode],...(theme.customEnabled?theme.custom[mode]:{})};
  return {...colors,mode,palette:theme.palette,hover:mix(colors.surface,colors.text,.07),border:mix(colors.surface,colors.text,.21),
    muted:mix(colors.surface,colors.text,.76),faint:mix(colors.surface,colors.text,.62),selected:mix(colors.surface,colors.accent,mode==='dark'?.18:.12),
    grid:mix(colors.stage,colors.text,.06),floor:mix(colors.stage,colors.text,.035),floorLine:mix(colors.stage,colors.text,.38),
    danger:mode==='dark'?'#ef9292':'#b12d43',warning:mode==='dark'?'#dfbc81':'#885817',
    overlay:mode==='dark'?'rgba(0,0,0,.75)':'rgba(29,38,49,.3)',shadow:mode==='dark'?'rgba(0,0,0,.65)':'rgba(35,44,56,.22)'};
}
