import {t as i18nText} from '../assets/i18n.js';
import { CUSTOM_ID } from '../assets/weapons.js';
import { WEAPONS } from '../assets/combat.js';

// A retried batch must never count twice, including a pagehide beacon in flight.
export function applyBeatBatch(stats, body) {
  const hits=body?.hits;
  if(!Array.isArray(hits)||hits.length<1||hits.length>256) throw new Error(i18nText("error.hitBatch"));
  for(const hit of hits) {
    if(!hit||typeof hit.id!=='string'||hit.id.length>120||(!Object.hasOwn(WEAPONS,hit.weapon)&&!(typeof hit.weapon==='string'&&CUSTOM_ID.test(hit.weapon)))||
      !Number.isSafeInteger(hit.damage)||hit.damage<1||hit.damage>100000||
      !Number.isSafeInteger(hit.combo)||hit.combo<1||hit.combo>1000000) throw new Error(i18nText("error.hit"));
  }
  const seen=new Set(Array.isArray(stats.recentHitIds)?stats.recentHitIds:[]);
  const result={...stats};let accepted=0;
  for(const hit of hits) {
    if(seen.has(hit.id))continue;
    seen.add(hit.id);accepted++;
    result.totalBeats=(result.totalBeats||0)+1;
    result.totalDamageDealt=(result.totalDamageDealt||0)+hit.damage;
    result.currentCombo=hit.combo;
    result.maxCombo=Math.max(result.maxCombo||0,hit.combo);
  }
  if(accepted)result.lastBeatenAt=Date.now();
  result.recentHitIds=[...seen].slice(-2048);
  return {stats:result,accepted};
}
