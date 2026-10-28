import {t as i18nText} from './i18n.js';

const validId=id=>typeof id==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const point=p=>p&&['x','y'].every(key=>Number.isFinite(p[key])&&Math.abs(p[key])<=Number.MAX_SAFE_INTEGER);
export function boneDescendants(bones,id){
  const ids=new Set([id]);let changed=true;
  while(changed){changed=false;for(const bone of bones)if(ids.has(bone.parent)&&!ids.has(bone.id)){ids.add(bone.id);changed=true;}}
  return ids;
}
export function normalizeBones(value,rig){
  if(value===undefined){
    // A one-time conversion preserves the old six-part joint anchors.
    const defaults={head:[0,-36],leftArm:[-30,-25],rightArm:[30,-25],leftLeg:[-17,36],rightLeg:[17,36]};
    const ids=new Map(rig.map((p,i)=>[p.id,'bone_'+i]));
    return rig.map(p=>{
      const parent=rig.find(q=>q.id===p.parent),d=parent?.id==='torso'?defaults[p.id]:null;
      let head={x:p.x,y:p.y-p.height/2},tail={x:p.x,y:p.y+p.height/2};
      if(parent){const dx=p.x-parent.x,dy=p.y-parent.y,t=1/Math.max(Math.abs(dx)/(parent.width/2),Math.abs(dy)/(parent.height/2),1);head=d?{x:parent.x+d[0]*parent.width/56,y:parent.y+d[1]*parent.height/72}:{x:parent.x+dx*t,y:parent.y+dy*t};tail={x:p.x,y:p.y};if(Math.hypot(tail.x-head.x,tail.y-head.y)<.01)tail.y+=Math.max(6,p.height/2);}
      p.bone=ids.get(p.id);
      return {id:ids.get(p.id),name:p.name,parent:ids.get(p.parent)??null,connected:false,color:'#d6b779',visible:true,head,tail};
    });
  }
  if(!Array.isArray(value)||value.length>128)throw new Error(i18nText('modeler.boneError'));
  const ids=new Set(),bones=value.map(b=>{
    if(!b||!validId(b.id)||ids.has(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>40||!point(b.head)||!point(b.tail)||Math.hypot(b.tail.x-b.head.x,b.tail.y-b.head.y)<.001||b.connected!==undefined&&typeof b.connected!=='boolean')throw new Error(i18nText('modeler.boneError'));
    if(b.color!==undefined&&!/^#[\da-f]{6}$/i.test(b.color)||b.visible!==undefined&&typeof b.visible!=='boolean')throw new Error(i18nText('modeler.boneError'));
    ids.add(b.id);return {id:b.id,name:b.name.trim(),parent:b.parent??null,connected:b.connected??false,color:b.color??'#d6b779',visible:b.visible??true,head:{x:b.head.x,y:b.head.y},tail:{x:b.tail.x,y:b.tail.y}};
  });
  const byId=new Map(bones.map(b=>[b.id,b]));
  for(const b of bones){const seen=new Set([b.id]);let id=b.parent;while(id!==null){if(!byId.has(id)||seen.has(id))throw new Error(i18nText('modeler.boneError'));seen.add(id);id=byId.get(id).parent;}if(b.connected&&(!b.parent||Math.hypot(b.head.x-byId.get(b.parent).tail.x,b.head.y-byId.get(b.parent).tail.y)>.001))throw new Error(i18nText('modeler.boneError'));}
  if(rig.some(p=>p.bone!=null&&!byId.has(p.bone)))throw new Error(i18nText('modeler.boneError'));
  for(const p of rig)p.bone??=null;
  return bones;
}

export function boneRoots(bones,ids){
  const selected=new Set(ids),byId=new Map(bones.map(b=>[b.id,b]));
  return bones.filter(b=>{if(!selected.has(b.id))return false;let parent=b.parent;while(parent){if(selected.has(parent))return false;parent=byId.get(parent)?.parent;}return true;}).map(b=>b.id);
}
export function moveBones(doc,ids,targetId,position){
  const roots=boneRoots(doc.bones,ids),all=new Set(roots.flatMap(id=>[...boneDescendants(doc.bones,id)])),target=doc.bones.find(b=>b.id===targetId);
  if(all.has(targetId))return false;
  const parent=position==='inside'?targetId:target?.parent??null;
  if(parent&&all.has(parent))return false;
  const moved=doc.bones.filter(b=>all.has(b.id)),remaining=doc.bones.filter(b=>!all.has(b.id));
  for(const id of roots){const b=moved.find(b=>b.id===id);if(b.parent!==parent){b.parent=parent;b.connected=false;}}
  const at=target?remaining.findIndex(b=>b.id===targetId)+(position==='before'?0:1):remaining.length;
  remaining.splice(at,0,...moved);doc.bones=remaining;return true;
}

export function translateBones(doc,ids,dx,dy){
  const selected=new Set(ids);
  for(const b of doc.bones)if(selected.has(b.id)){b.head={x:b.head.x+dx,y:b.head.y+dy};b.tail={x:b.tail.x+dx,y:b.tail.y+dy};if(!selected.has(b.parent))b.connected=false;}
  const walk=parent=>{for(const b of doc.bones.filter(b=>b.parent===(parent?.id??null))){
    if(parent&&b.connected&&!selected.has(b.id)){const x=parent.tail.x-b.head.x,y=parent.tail.y-b.head.y;b.head={...parent.tail};b.tail={x:b.tail.x+x,y:b.tail.y+y};}
    walk(b);
  }};walk(null);
}

// Reduce the armature to rigid-body constraints once, outside the frame loop.
export function resolveBoneRig(rig,bones){
  const byId=new Map(bones.map(b=>[b.id,b])),bindings=new Map();
  for(const p of [...rig].sort((a,b)=>a.id.localeCompare(b.id)))if(p.bone&&!bindings.has(p.bone))bindings.set(p.bone,p);
  return rig.map(p=>{
    const bone=byId.get(p.bone);if(!bone)return {...p,parent:null,joint:null};
    const primary=bindings.get(bone.id);let parent=primary!==p?primary:null,id=bone.parent;
    while(!parent&&id){parent=bindings.get(id);id=byId.get(id).parent;}
    return {...p,parent:parent?.id??null,joint:parent?{...bone.head}:null};
  });
}

export function poseBone(doc,id,angle=0,dx=0,dy=0){
  const bone=doc.bones.find(b=>b.id===id);if(!bone)return;
  const ids=boneDescendants(doc.bones,id),origin=bone.head,c=Math.cos(angle),s=Math.sin(angle);
  const transform=p=>({x:origin.x+(p.x-origin.x)*c-(p.y-origin.y)*s+dx,y:origin.y+(p.x-origin.x)*s+(p.y-origin.y)*c+dy});
  for(const p of doc.rig)if(ids.has(p.bone)){Object.assign(p,transform(p));p.rotation=((p.rotation+angle*180/Math.PI+540)%360)-180;}
  for(const b of doc.bones)if(ids.has(b.id)){const head=transform(b.head),tail=transform(b.tail);b.head=head;b.tail=tail;}
  if((dx||dy)&&bone.connected)bone.connected=false;
}

export function editBone(doc,id,patch){
  const bone=doc.bones.find(b=>b.id===id);if(!bone)return;
  Object.assign(bone,patch);
  if(bone.connected&&bone.parent){const parent=doc.bones.find(b=>b.id===bone.parent);if(parent){const dx=parent.tail.x-bone.head.x,dy=parent.tail.y-bone.head.y;bone.head={...parent.tail};bone.tail={x:bone.tail.x+dx,y:bone.tail.y+dy};}}
  // Connected children keep their junctions while unconnected children retain offsets.
  const walk=parent=>{for(const child of doc.bones.filter(b=>b.parent===parent.id&&b.connected)){const dx=parent.tail.x-child.head.x,dy=parent.tail.y-child.head.y;child.head={...parent.tail};child.tail={x:child.tail.x+dx,y:child.tail.y+dy};walk(child);}};
  if(!boneDescendants(doc.bones,id).has(bone.parent))walk(bone);
}

export function removeBone(doc,id){
  const bone=doc.bones.find(b=>b.id===id);if(!bone)return;
  doc.bones=doc.bones.filter(b=>b!==bone);
  for(const b of doc.bones)if(b.parent===id){b.parent=bone.parent;b.connected=false;}
  for(const p of doc.rig)if(p.bone===id)p.bone=null;
}
