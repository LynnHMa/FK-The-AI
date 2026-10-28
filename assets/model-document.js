import {normalizeRig,normalizeGroups} from './puppet.js';
import {t as i18nText} from './i18n.js';
import {normalizeBones} from './armature.js';

// Clone mutable records while sharing immutable asset strings across undo snapshots.
export const copyDocument=value=>Array.isArray(value)?value.map(copyDocument):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copyDocument(item)])):value;
export function sameModelAssets(a,b) {
  const texturesA=a.textures??{},texturesB=b.textures??{},sequencesA=a.sequences??{},sequencesB=b.sequences??{};
  return Object.keys(texturesA).length===Object.keys(texturesB).length&&Object.keys(texturesA).every(id=>texturesA[id]===texturesB[id])&&Object.keys(sequencesA).length===Object.keys(sequencesB).length&&Object.keys(sequencesA).every(id=>{const x=sequencesA[id],y=sequencesB[id];return y&&x.fps===y.fps&&x.frames.length===y.frames.length&&x.frames.every((frame,i)=>frame===y.frames[i]);});
}
export const sameModelDocument=(a,b)=>JSON.stringify([a.rig,a.groups,a.layers,a.bones])===JSON.stringify([b.rig,b.groups,b.layers,b.bones])&&sameModelAssets(a,b);
export function modelDocument(value={}) {
  const rig=normalizeRig(value.rig),groups=normalizeGroups(value.groups,rig);
  const ids=[...rig,...groups].map(p=>p.id),layers=value.layers;
  if(layers!==undefined&&(!Array.isArray(layers)||layers.length!==ids.length||new Set(layers).size!==layers.length||layers.some(id=>!ids.includes(id))))throw new Error(i18nText('modeler.groupError'));
  const bones=normalizeBones(value.bones,rig);
  // Parent links are legacy import data; the armature alone owns connections.
  for(const p of rig){p.parent=null;delete p.joint;}
  return flattenLayers({rig,groups,bones,layers:layers?[...layers]:undefined,textures:{...value.textures},sequences:copyDocument(value.sequences??{})});
}
export function groupIds(doc,id) {
  const ids=new Set([id]);let changed=true;
  while(changed){changed=false;for(const g of doc.groups)if(ids.has(g.parent)&&!ids.has(g.id)){ids.add(g.id);changed=true;}}
  return ids;
}
export function layerParts(doc,id) {
  if(doc.rig.some(p=>p.id===id))return doc.rig.filter(p=>p.id===id);
  const ids=groupIds(doc,id);return doc.rig.filter(p=>ids.has(p.group));
}
export function layerChildren(doc,parent=null) {
  const rank=g=>{const members=layerParts(doc,g.id);return members.length?Math.max(...members.map(p=>doc.rig.indexOf(p))):doc.rig.length+doc.groups.indexOf(g);};
  return [...doc.rig.filter(p=>p.group===parent).map(p=>({kind:'part',value:p,rank:doc.layers?doc.layers.indexOf(p.id):doc.rig.indexOf(p)})),...doc.groups.filter(g=>g.parent===parent).map(g=>({kind:'group',value:g,rank:doc.layers?doc.layers.indexOf(g.id):rank(g)}))].sort((a,b)=>b.rank-a.rank);
}
export function flattenLayers(doc) {
  const layers=[],parts=[],walk=parent=>{for(const item of layerChildren(doc,parent).reverse()){layers.push(item.value.id);if(item.kind==='part')parts.push(item.value);else walk(item.value.id);}};
  walk(null);doc.rig=parts;doc.layers=layers;return doc;
}
// Reconcile non-structural API edits and legacy presets without losing sibling order.
export function reconcileLayers(layers,rig,groups) {
  if(!layers)return undefined;
  const ids=[...rig,...groups].map(p=>p.id);return [...layers.filter(id=>ids.includes(id)),...ids.filter(id=>!layers.includes(id))];
}
export function moveLayer(doc,id,targetId,position) {
  const next=copyDocument(doc),source=next.rig.find(p=>p.id===id)||next.groups.find(g=>g.id===id),isGroup=next.groups.includes(source);
  if(!source||id===targetId)return doc;
  const descendants=isGroup?groupIds(next,id):new Set();
  const target=next.rig.find(p=>p.id===targetId)||next.groups.find(g=>g.id===targetId);
  if(target&&(descendants.has(target.id)||descendants.has(target.group)))return doc;
  const parent=position==='inside'?(target?.id??null):target?(next.groups.includes(target)?target.parent:target.group):null;
  if(parent&&(!next.groups.some(g=>g.id===parent)||descendants.has(parent)))return doc;
  const ids=new Set([id,...descendants,...layerParts(next,id).map(p=>p.id)]),targetIds=target?new Set([target.id,...(next.groups.includes(target)?groupIds(next,target.id):[]),...layerParts(next,target.id).map(p=>p.id)]):new Set();
  const indices=next.layers.map((id,i)=>targetIds.has(id)?i:-1).filter(i=>i>=0),anchor=indices.length?(position==='after'?Math.min(...indices):Math.max(...indices)+1):next.layers.length;
  const before=next.layers.slice(0,anchor).filter(id=>!ids.has(id)).length,moved=next.layers.filter(id=>ids.has(id));
  next.layers=next.layers.filter(id=>!ids.has(id));next.layers.splice(before,0,...moved);
  if(isGroup)source.parent=parent;else source.group=parent;
  return flattenLayers(next);
}
export function removeLayer(doc,id,ungroup=false) {
  const next=copyDocument(doc),group=next.groups.find(g=>g.id===id);
  if(group){
    if(ungroup){next.groups=next.groups.filter(g=>g!==group);for(const g of next.groups)if(g.parent===id)g.parent=group.parent;for(const p of next.rig)if(p.group===id)p.group=group.parent;next.layers=next.layers.filter(value=>value!==id);return flattenLayers(next);}
    const ids=groupIds(next,id),parts=layerParts(next,id),partIds=new Set(parts.map(p=>p.id));if(parts.length===next.rig.length)return doc;
    next.groups=next.groups.filter(g=>!ids.has(g.id));next.rig=next.rig.filter(p=>!partIds.has(p.id));
    for(const p of next.rig){let parent=p.parent;while(partIds.has(parent))parent=parts.find(p=>p.id===parent)?.parent??null;p.parent=parent;}
    for(const p of parts){delete next.textures[p.id];delete next.sequences[p.id];}
    next.layers=next.layers.filter(id=>!ids.has(id)&&!partIds.has(id));return flattenLayers(next);
  }
  const part=next.rig.find(p=>p.id===id);if(!part||next.rig.length===1)return doc;
  next.rig=next.rig.filter(p=>p!==part);for(const p of next.rig)if(p.parent===id)p.parent=part.parent;
  delete next.textures[id];delete next.sequences[id];next.layers=next.layers.filter(value=>value!==id);return next;
}

export function selectionParts(doc,ids){
  const parts=new Set([...ids].flatMap(id=>layerParts(doc,id).map(p=>p.id)));
  return doc.rig.filter(p=>parts.has(p.id));
}
export function selectionRoots(doc,ids){
  const selected=new Set(ids),parents=new Map(doc.groups.map(g=>[g.id,g.parent]));
  return doc.layers.filter(id=>{if(!selected.has(id))return false;let parent=doc.rig.find(p=>p.id===id)?.group??parents.get(id);while(parent){if(selected.has(parent))return false;parent=parents.get(parent);}return true;});
}
export function moveLayers(doc,ids,target,position){
  const roots=selectionRoots(doc,ids),all=new Set([...roots,...selectionParts(doc,roots).map(p=>p.id),...roots.flatMap(id=>doc.groups.some(g=>g.id===id)?[...groupIds(doc,id)]:[])]);
  if(all.has(target))return doc;
  let next=doc;for(const id of position==='before'?[...roots].reverse():roots)next=moveLayer(next,id,target,position);
  return next;
}
export function removeLayers(doc,ids){
  const roots=selectionRoots(doc,ids);if(selectionParts(doc,roots).length===doc.rig.length)return doc;
  return roots.reduce((next,id)=>removeLayer(next,id),doc);
}
export function addModelPart(doc,name,id,anchor=null){
  if(doc.rig.length>=24)return null;
  const next=copyDocument(doc),part=next.rig.find(p=>p.id===anchor),group=next.groups.find(g=>g.id===anchor),index=next.layers.indexOf(anchor);
  next.rig.push({id,name,parent:null,bone:null,group:part?.group??group?.parent??null,x:part?part.x+part.width/2+15:0,y:part?.y??0,width:30,height:40});
  next.layers.splice(Math.max(0,index),0,id);
  return flattenLayers(next);
}

// SAT includes rotated parts whose centers lie outside a selection rectangle.
export function partIntersectsBox(part,box){
  const a=(part.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:part.x+x*part.width/2*c-y*part.height/2*s,y:part.y+x*part.width/2*s+y*part.height/2*c}));
  const rect=[{x:box.left,y:box.top},{x:box.right,y:box.top},{x:box.right,y:box.bottom},{x:box.left,y:box.bottom}];
  return [{x:1,y:0},{x:0,y:1},{x:c,y:s},{x:-s,y:c}].every(axis=>{const p=corners.map(v=>v.x*axis.x+v.y*axis.y),r=rect.map(v=>v.x*axis.x+v.y*axis.y);return Math.max(...p)>=Math.min(...r)&&Math.max(...r)>=Math.min(...p);});
}
