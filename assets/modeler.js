import {t as i18nText,h as i18nHtml,bindText,bindAttribute,onLanguageChange} from './i18n.js';
import {loadPuppetImages,frameAt,drawPartImage,resolvedRig,clipPart,normalizeShapeMask,maskDisplayPoints} from './puppet.js';
import {modelDocument,copyDocument,layerChildren,layerParts,groupIds,moveLayer,removeLayer,flattenLayers,sameModelAssets,sameModelDocument,selectionParts,selectionRoots,moveLayers,removeLayers,addModelPart,partIntersectsBox} from './model-document.js';
import {boneDescendants,poseBone,editBone,removeBone,boneRoots,moveBones,translateBones} from './armature.js';

const iconPaths={
  move:'M4 3v17l5-5 4 7 3-2-4-6 7-1Z',
  crop:'M6 3v15h15M3 6h15v15',
  bone:'m6 5 13 4-4 10-9-4Zm0 0 9 14M4 3h4v4H4Zm9 14h4v4h-4Z',
  pose:'M5 18 10 8l9 4M8 5h4v4H8Zm9 5h4v4h-4ZM3 17h4v4H3Z',
  undo:'M9 3 4 8l5 5M4 8h10a6 6 0 0 1 0 12h-4',
  redo:'m15 3 5 5-5 5m5-5H10a6 6 0 0 0 0 12h4',
  copy:'M9 9h12v12H9ZM15 6V3H3v12h3',
  cut:'m8 8 12 12M8 16 20 4M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  paste:'M9 4H5v17h14V4h-4M9 2h6v5H9Z',
  duplicate:'M8 8h13v13H8ZM15 5V2H2v13h3M11 14h7m-3.5-3.5v7',
  delete:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  fit:'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M8 8h8v8H8Z',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  eyeOff:'m3 3 18 18M10 5h2c6 0 10 7 10 7a19 19 0 0 1-4 4M6 6a20 20 0 0 0-4 6s4 7 10 7h2',
  drag:'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  group:'M3 7V4h6l3 3h9v13H3Zm0 0h9',
  groupAdd:'M3 12V4h6l3 3h9v5M3 16v4h8m5-4h6m-3-3v6',
  part:'M4 3h16v18H4ZM8 7h8v6H8Zm0 10h8',
  add:'M12 4v16M4 12h16',
  expand:'m9 5 7 7-7 7',
  collapse:'m5 9 7 7 7-7'
};
export const modelIcon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPaths[name]||iconPaths.part}"/></svg>`;

// Local document transactions: pointer movement never performs IO. One gesture = one undo step.
export function createModeler(root,options) {
  const tools=['move','crop','bone','pose','undo','redo','copy','cut','paste','duplicate','delete','fit'].map(act=>[act,modelIcon(act)]);
  const key=act=>({undo:'modeler.001',redo:'modeler.002',fit:'modeler.006'})[act]||'modeler.'+act;
  root.innerHTML=`<header class="fk-modeler-toolbar"><div><b>${i18nHtml('modeler.004')}</b></div>${tools.map(([act,icon])=>`<button type="button" data-act="${act}" title="${i18nHtml(key(act))}" aria-label="${i18nHtml(key(act))}">${icon}</button>`).join('')}<button type="button" data-act="cropApply" hidden>${i18nHtml('modeler.cropApply')}</button></header><div class="fk-model-crop-tools" hidden><label>${i18nHtml('modeler.cropMode')}<select id="fk-crop-mode"><option value="rect">${i18nHtml('modeler.cropRectangle')}</option><option value="polygon">${i18nHtml('modeler.cropPolygon')}</option><option value="lasso">${i18nHtml('modeler.cropLasso')}</option></select></label><label><input type="checkbox" id="fk-crop-invert">${i18nHtml('modeler.cropInvert')}</label><button type="button" id="fk-crop-clear">${i18nHtml('modeler.cropClearSelection')}</button><small id="fk-crop-hint"></small><small>${i18nHtml('modeler.cropMaskHint')}</small></div><canvas id="fk-model-canvas" tabindex="0" aria-label="${i18nHtml('modeler.003')}"></canvas><footer><span id="fk-model-info"></span><span>${i18nHtml('modeler.shortcuts')}</span></footer>`;
  const armature=document.createElement('section');armature.id='fk-armature';armature.hidden=true;
  armature.innerHTML=`<header class="fk-armature-head"><strong>${i18nHtml('modeler.armature')}</strong><button type="button" id="fk-bone-add" title="${i18nHtml('modeler.boneAdd')}" aria-label="${i18nHtml('modeler.boneAdd')}">${modelIcon('add')}</button></header><div id="fk-bone-list" class="fk-bone-list fk-layer-tree" role="tree" tabindex="0" aria-multiselectable="true"></div><p id="fk-bone-bind-info" class="fk-ai-editor-hint"></p><div class="fk-inspector-actions"><button type="button" id="fk-bone-bind">${i18nHtml('modeler.bindSelected')}</button><button type="button" id="fk-bone-unbind">${i18nHtml('modeler.unbindSelected')}</button></div><form id="fk-bone-form" hidden><label>${i18nHtml('modeler.boneName')}<input class="fk-ai-input-text" id="fk-bone-name" maxlength="40" required></label><label>${i18nHtml('modeler.boneColor')}<input id="fk-bone-color" type="color"></label><label>${i18nHtml('modeler.boneParent')}<select id="fk-bone-parent"></select></label><label class="fk-ai-control-row"><input type="checkbox" id="fk-bone-connected"><span>${i18nHtml('modeler.boneConnected')}</span></label><div class="fk-inspector-grid">${[['headX','modeler.boneHeadX'],['headY','modeler.boneHeadY'],['tailX','modeler.boneTailX'],['tailY','modeler.boneTailY']].map(([id,key])=>`<label>${i18nHtml(key)}<input class="fk-ai-input-text" id="fk-bone-${id}" type="number" step="any" required></label>`).join('')}</div><div class="fk-inspector-actions"><button type="submit">${i18nHtml('modeler.boneSave')}</button><button type="button" id="fk-bone-delete">${i18nHtml('modeler.boneDelete')}</button></div></form><small class="fk-ai-editor-hint">${i18nHtml('modeler.boneHint')}</small>`;
  options.sidebar.querySelector('.fk-inspector-head').after(armature);
  const canvas=root.querySelector('canvas'),c=canvas.getContext('2d'),sidebar=options.sidebar,tree=sidebar.querySelector('#fk-layer-tree'),undo=[],redo=[],collapsed=new Set(),selection=new Set(['torso']),boneSelection=new Set(),boneCollapsed=new Set();tree.tabIndex=0;tree.setAttribute('aria-multiselectable','true');bindAttribute(tree,'aria-label',()=>i18nText('modeler.layers'));bindAttribute(tree,'title',()=>i18nText('modeler.groupHint')+'\n'+i18nText('modeler.selectionHint'));
  let preset=null,doc=modelDocument(),selected='torso',images=null,zoom=1,cx=0,cy=0,w=0,h=0,gesture=null,busy=false,revision=0,animation=0,tool='move',space=false,clipboard=null,cropDraft=null,cropMode='rect',cropInverted=false,cropHover=null,dragId=null,lastValue,activeBone=null,treeBox=null,suppressTreeClick=false,boneDraftKey=null,layerAnchor=null,boneAnchor=null,boneDrag=null,boneClipboard=null;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),part=()=>doc.rig.find(p=>p.id===selected),group=()=>doc.groups.find(g=>g.id===selected),rad=p=>(p.rotation||0)*Math.PI/180;
  bindAttribute(canvas,'title',()=>i18nText('modeler.selectionHint'));
  const selectedParts=()=>selectionParts(doc,selection),bone=()=>doc.bones.find(b=>b.id===activeBone),boneMode=()=>tool==='bone'||tool==='pose';
  const local=(p,q)=>{const a=rad(p),dx=q.x-p.x,dy=q.y-p.y;return{x:dx*Math.cos(a)+dy*Math.sin(a),y:-dx*Math.sin(a)+dy*Math.cos(a)};};
  const world=(p,x,y)=>({x:p.x+x*Math.cos(rad(p))-y*Math.sin(rad(p)),y:p.y+x*Math.sin(rad(p))+y*Math.cos(rad(p))});
  const contains=(p,q)=>{const a=local(p,q);return Math.abs(a.x)<=p.width/2&&Math.abs(a.y)<=p.height/2;};
  const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left-cx)/zoom,y:(e.clientY-r.top-cy)/zoom};};
  const handles=p=>[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1],[0,-2]].map(([dx,dy])=>({...world(p,dx*p.width/2,dy===-2?-p.height/2-26/zoom:dy*p.height/2),dx,dy}));
  function inform(){
    const p=part(),g=group();bindText(root.querySelector('#fk-model-info'),()=>boneMode()?(bone()?i18nText('modeler.boneSelection',{name:bone().name,count:doc.rig.filter(p=>p.bone===activeBone).length}):i18nText('modeler.armature')):selectedParts().length>1?i18nText('modeler.multiSelected',{count:selectedParts().length}):tool==='crop'?i18nText(cropMode==='polygon'?'modeler.cropPolygonHint':cropMode==='lasso'?'modeler.cropLassoHint':'modeler.cropHint'):p?`${p.name}   ${Math.round(p.width)} × ${Math.round(p.height)}   (${Math.round(p.x)}, ${Math.round(p.y)})`:g?i18nText('modeler.groupSelected',{count:layerParts(doc,g.id).length}):i18nText('modeler.emptySelection'));
    for(const [act]of tools){const el=root.querySelector(`[data-act="${act}"]`);el.disabled=busy||!preset||(act==='undo'&&!undo.length)||(act==='redo'&&!redo.length)||(act==='paste'&&!(boneMode()?boneClipboard:clipboard))||(act==='crop'&&!p);if(['move','crop','bone','pose'].includes(act))el.setAttribute('aria-pressed',String(act===tool));}
    root.querySelector('[data-act="cropApply"]').hidden=!cropDraft;root.querySelector('[data-act="cropApply"]').disabled=busy||!part()||!!cropDraft?.points&&cropDraft.points.length<3;root.querySelector('.fk-model-crop-tools').hidden=tool!=='crop';root.querySelector('#fk-crop-invert').checked=cropInverted;
    bindText(root.querySelector('#fk-crop-hint'),()=>i18nText(cropMode==='polygon'?'modeler.cropPolygonHint':cropMode==='lasso'?'modeler.cropLassoHint':'modeler.cropHint'));
    for(const input of root.querySelectorAll('.fk-model-crop-tools input,.fk-model-crop-tools select,.fk-model-crop-tools button'))input.disabled=busy||!p;
  }
  function draw(){
    if(!w||!h)return;const ratio=Math.min(devicePixelRatio||1,2);c.setTransform(ratio,0,0,ratio,0,0);c.clearRect(0,0,w,h);
    const style=getComputedStyle(root),color=k=>style.getPropertyValue(k).trim();c.fillStyle=color('--nl-bg');c.fillRect(0,0,w,h);c.save();c.translate(cx,cy);c.scale(zoom,zoom);
    c.strokeStyle=color('--nl-border');c.lineWidth=1/zoom;
    const left=-cx/zoom,right=(w-cx)/zoom,top=-cy/zoom,bottom=(h-cy)/zoom,grid=20*Math.pow(10,Math.max(0,Math.ceil(Math.log10(8/(20*zoom)))));
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();}
    c.strokeStyle=color('--nl-text-faint');c.beginPath();c.moveTo(0,top);c.lineTo(0,bottom);c.moveTo(left,0);c.lineTo(right,0);c.stroke();
    const visible=resolvedRig({...doc,bones:undefined});
    for(const p of visible){
      if(!p.visible||p.opacity===0)continue;
      const texture=images&&(frameAt(images.skins,images.sequences,p.id,performance.now()/1000)||(p.id==='head'?images.avatar:null));
      const visual=tool==='crop'&&p.id===selected&&cropDraft?{...p,mask:null}:p;
      c.save();c.translate(p.x,p.y);c.rotate(rad(p));c.globalAlpha=p.opacity;
      if(texture)drawPartImage(c,texture,visual,-p.width/2,-p.height/2,p.width,p.height);
      else{clipPart(c,visual,-p.width/2,-p.height/2,p.width,p.height);c.scale(p.flipX?-1:1,p.flipY?-1:1);c.fillStyle=color('--nl-surface-hover');c.strokeStyle=color('--nl-text-muted');c.beginPath();c.roundRect(-p.width/2,-p.height/2,p.width,p.height,Math.min(6,p.width/4));c.fill();c.stroke();if(p.id==='head'){c.fillStyle=color('--nl-text');c.fillRect(-12,-7,5,4);c.fillRect(7,-7,5,4);}}
      c.restore();
    }
    const p=part();if(p&&!boneMode()&&selectedParts().length===1){
      c.strokeStyle=color('--nl-accent-blue');c.lineWidth=1.5/zoom;c.save();c.translate(p.x,p.y);c.rotate(rad(p));c.strokeRect(-p.width/2,-p.height/2,p.width,p.height);c.beginPath();c.moveTo(0,-p.height/2);c.lineTo(0,-p.height/2-26/zoom);c.stroke();c.restore();
      if(tool!=='crop')for(const q of handles(p)){c.fillStyle=color('--nl-surface');c.beginPath();if(q.dy===-2)c.arc(q.x,q.y,5/zoom,0,Math.PI*2);else c.rect(q.x-4/zoom,q.y-4/zoom,8/zoom,8/zoom);c.fill();c.stroke();}
      if(cropDraft)drawCropDraft(p,color);
    }
    if(selectedParts().length>1||group()){c.setLineDash([5/zoom,4/zoom]);for(const p of selectedParts()){c.save();c.translate(p.x,p.y);c.rotate(rad(p));c.strokeStyle=color('--nl-accent-blue');c.strokeRect(-p.width/2,-p.height/2,p.width,p.height);c.restore();}c.setLineDash([]);}
    if(boneMode())drawBones(color);
    if(gesture?.box){const b=gesture.box;c.fillStyle=color('--nl-accent-blue');c.globalAlpha=.14;c.fillRect(b.left,b.top,b.right-b.left,b.bottom-b.top);c.globalAlpha=1;c.strokeStyle=color('--nl-accent-blue');c.lineWidth=1/zoom;c.strokeRect(b.left,b.top,b.right-b.left,b.bottom-b.top);}
    c.restore();inform();
  }
  const cropPoint=(p,q)=>{const pt=local(p,q);return {x:clamp(pt.x,-p.width/2,p.width/2),y:clamp(pt.y,-p.height/2,p.height/2)};};
  const cropPoints=a=>a.points??[{x:a.x,y:a.y},{x:a.x+a.width,y:a.y},{x:a.x+a.width,y:a.y+a.height},{x:a.x,y:a.y+a.height}];
  function drawCropDraft(p,color){
    const a=cropDraft,points=cropPoints(a);c.save();c.translate(p.x,p.y);c.rotate(rad(p));
    if(points.length>=3){c.save();c.beginPath();c.rect(-p.width/2,-p.height/2,p.width,p.height);c.clip();c.beginPath();if(!cropInverted)c.rect(-p.width/2,-p.height/2,p.width,p.height);points.forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));c.closePath();c.fillStyle=color('--nl-bg');c.globalAlpha=.72;c.fill('evenodd');c.restore();}
    c.strokeStyle=color('--nl-accent-blue');c.lineWidth=1.5/zoom;c.setLineDash([5/zoom,3/zoom]);c.beginPath();points.forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));if(!a.points||a.closed)c.closePath();else if(cropHover)c.lineTo(cropHover.x,cropHover.y);c.stroke();c.setLineDash([]);
    if(a.points)for(const v of points){c.fillStyle=color('--nl-surface');c.beginPath();c.arc(v.x,v.y,4/zoom,0,Math.PI*2);c.fill();c.stroke();}c.restore();
  }
  function boneVisible(b){if(b.visible===false)return false;let id=b.parent;while(id){const parent=doc.bones.find(b=>b.id===id);if(parent.visible===false)return false;id=parent.parent;}return true;}
  function drawBones(color){
    const labels=[];
    for(const b of doc.bones){const dx=b.tail.x-b.head.x,dy=b.tail.y-b.head.y,len=Math.hypot(dx,dy),nx=-dy/len*6/zoom,ny=dx/len*6/zoom,mx=b.head.x+dx*.25,my=b.head.y+dy*.25;
      if(!boneVisible(b))continue;c.strokeStyle=b.color;c.fillStyle=b.color;c.fillStyle=c.strokeStyle;c.lineWidth=(boneSelection.has(b.id)?3:1.5)/zoom;
      c.beginPath();c.moveTo(b.head.x,b.head.y);c.lineTo(mx+nx,my+ny);c.lineTo(b.tail.x,b.tail.y);c.lineTo(mx-nx,my-ny);c.closePath();c.globalAlpha=b.id===activeBone ? .45 : .18;c.fill();c.globalAlpha=1;c.stroke();
      if(b.parent&&!b.connected){const parent=doc.bones.find(v=>v.id===b.parent);if(parent){c.setLineDash([3/zoom,3/zoom]);c.beginPath();c.moveTo(parent.tail.x,parent.tail.y);c.lineTo(b.head.x,b.head.y);c.stroke();c.setLineDash([]);}}
      for(const p of [b.head,b.tail]){c.beginPath();c.arc(p.x,p.y,4/zoom,0,Math.PI*2);c.fillStyle=color('--nl-bg');c.fill();c.stroke();}
      c.save();c.font=`${11/zoom}px system-ui`;const tw=c.measureText(b.name).width+14/zoom,th=22/zoom;
      let lx=(b.head.x+b.tail.x)/2+12/zoom,ly=(b.head.y+b.tail.y)/2-th/2;
      for(let n=0;n<doc.bones.length;n++){if(!labels.some(r=>lx<r.x+r.w&&lx+tw>r.x&&ly<r.y+r.h&&ly+th>r.y))break;ly+=th+3/zoom;}
      labels.push({x:lx,y:ly,w:tw,h:th});c.strokeStyle=b.color;c.lineWidth=1/zoom;c.globalAlpha=.65;c.beginPath();c.moveTo((b.head.x+b.tail.x)/2,(b.head.y+b.tail.y)/2);c.lineTo(lx,ly+th/2);c.stroke();c.globalAlpha=.94;c.fillStyle=color('--nl-bg');c.fillRect(lx,ly,tw,th);c.globalAlpha=1;c.strokeStyle=b.color;c.lineWidth=1/zoom;c.strokeRect(lx,ly,tw,th);c.fillStyle=b.color;c.textAlign='left';c.textBaseline='middle';c.fillText(b.name,lx+7/zoom,ly+th/2);c.restore();
    }
  }
  function renderBones(){
    armature.hidden=!boneMode();const list=armature.querySelector('#fk-bone-list'),scroll=list.scrollTop,focused=list.contains(document.activeElement),focusedId=document.activeElement.closest?.('[data-bone-id]')?.dataset.boneId,focusedAction=document.activeElement.dataset?.boneAction;list.replaceChildren();
    for(const id of boneSelection)if(!doc.bones.some(b=>b.id===id))boneSelection.delete(id);
    if(!boneSelection.has(activeBone))activeBone=[...boneSelection].at(-1)??null;
    const append=(parent,depth)=>{for(const item of doc.bones.filter(b=>b.parent===parent)){
      const row=document.createElement('div');row.className='fk-layer-row';row.dataset.boneId=item.id;row.dataset.kind='bone';row.style.setProperty('--depth',depth);row.draggable=!busy;row.setAttribute('role','treeitem');row.setAttribute('aria-selected',String(boneSelection.has(item.id)));row.setAttribute('aria-pressed',String(item.id===activeBone));row.setAttribute('aria-level',String(depth+1));
      const eye=document.createElement('button');eye.type='button';eye.dataset.boneAction='visible';eye.className='fk-layer-eye';eye.innerHTML=modelIcon(item.visible?'eye':'eyeOff');eye.disabled=busy;bindAttribute(eye,'aria-label',()=>i18nText(item.visible?'modeler.hide':'modeler.show'));row.append(eye);
      if(doc.bones.some(b=>b.parent===item.id)){const fold=document.createElement('button');fold.type='button';fold.dataset.boneAction='collapse';fold.className='fk-layer-fold';fold.innerHTML=modelIcon(boneCollapsed.has(item.id)?'expand':'collapse');bindAttribute(fold,'aria-label',()=>i18nText(boneCollapsed.has(item.id)?'modeler.expand':'modeler.collapse'));row.append(fold);row.setAttribute('aria-expanded',String(!boneCollapsed.has(item.id)));}
      const icon=document.createElement('span');icon.className='fk-layer-thumb';icon.style.color=item.color;icon.innerHTML=modelIcon('bone');row.append(icon);
      const name=document.createElement('span');name.className='fk-layer-name';name.dataset.i18nSkip='';name.textContent=item.name;row.append(name);row.classList.toggle('fk-layer-muted',!item.visible);list.append(row);if(!boneCollapsed.has(item.id))append(item.id,depth+1);
    }};append(null,0);
    const drop=document.createElement('div');drop.className='fk-layer-root';drop.dataset.boneRoot='';bindText(drop,()=>i18nText('modeler.rootDrop'));list.append(drop);list.scrollTop=scroll;
    if(focused){const row=[...list.querySelectorAll('[data-bone-id]')].find(row=>row.dataset.boneId===focusedId),target=focusedAction?row?.querySelector(`[data-bone-action="${focusedAction}"]`):list;(target&&!target.disabled?target:list).focus({preventScroll:true});list.scrollTop=scroll;}
    const b=bone();
    bindText(armature.querySelector('#fk-bone-bind-info'),()=>i18nText('modeler.bindInfo',{count:selectedParts().length,name:bone()?.name||i18nText('modeler.boneNone')}));
    armature.querySelector('#fk-bone-bind').disabled=busy||!b||!selectedParts().length;armature.querySelector('#fk-bone-unbind').disabled=busy||!selectedParts().length;armature.querySelector('#fk-bone-add').disabled=busy||doc.bones.length>=128;
    const form=armature.querySelector('#fk-bone-form');form.hidden=!b;
    if(!b){boneDraftKey=null;return;}
    const parent=armature.querySelector('#fk-bone-parent'),draftParent=parent.value,exclude=boneDescendants(doc.bones,b.id),nextKey=JSON.stringify(b);parent.replaceChildren(new Option(i18nText('modeler.boneRoot'),''),...doc.bones.filter(b=>!exclude.has(b.id)).map(b=>new Option(b.name,b.id)));
    if(boneDraftKey!==nextKey){armature.querySelector('#fk-bone-name').value=b.name;armature.querySelector('#fk-bone-color').value=b.color;parent.value=b.parent||'';armature.querySelector('#fk-bone-connected').checked=b.connected;for(const key of ['headX','headY','tailX','tailY'])armature.querySelector('#fk-bone-'+key).value=b[key.slice(0,-1)][key.at(-1).toLowerCase()];boneDraftKey=nextKey;}
    else parent.value=draftParent;
    for(const input of form.elements)input.disabled=busy;
  }
  function boneHit(q){
    const ordered=doc.bones.filter(boneVisible).sort((a,b)=>Number(a.id===activeBone)-Number(b.id===activeBone)).reverse();let hit=null;
    for(const b of ordered){for(const endpoint of ['head','tail'])if(Math.hypot(q.x-b[endpoint].x,q.y-b[endpoint].y)<9/zoom){hit={b,endpoint};break;}if(hit)break;}
    if(!hit)for(const b of ordered){const dx=b.tail.x-b.head.x,dy=b.tail.y-b.head.y,t=clamp(((q.x-b.head.x)*dx+(q.y-b.head.y)*dy)/(dx*dx+dy*dy),0,1);if(Math.hypot(q.x-b.head.x-dx*t,q.y-b.head.y-dy*t)<8/zoom){hit={b,endpoint:'body'};break;}}
    return hit;
  }
  function startBoneGesture(q){
    const hit=boneHit(q);if(!hit){chooseBones([]);return false;}if(!boneSelection.has(hit.b.id))chooseBone(hit.b.id);activeBone=hit.b.id;gesture={bone:true,id:activeBone,endpoint:hit.endpoint,before:copyDocument(doc),start:q,ids:[...boneSelection]};renderBones();draw();return true;
  }
  function moveBoneGesture(q,e){
    const g=gesture;doc=copyDocument(g.before);const b=doc.bones.find(b=>b.id===g.id);
    if(tool==='pose'){
      if(g.endpoint==='tail'){let angle=Math.atan2(q.y-b.head.y,q.x-b.head.x)-Math.atan2(g.start.y-b.head.y,g.start.x-b.head.x);if(e.shiftKey)angle=Math.round(angle/(Math.PI/12))*Math.PI/12;for(const id of boneRoots(doc.bones,g.ids))poseBone(doc,id,angle);}
      else for(const id of boneRoots(doc.bones,g.ids))poseBone(doc,id,0,q.x-g.start.x,q.y-g.start.y);
    }else if(g.endpoint==='body'){translateBones(doc,g.ids,q.x-g.start.x,q.y-g.start.y);}
    else{const other=b[g.endpoint==='head'?'tail':'head'];if(Math.hypot(q.x-other.x,q.y-other.y)>.001)editBone(doc,b.id,{[g.endpoint]:{...q},...(g.endpoint==='head'?{connected:false}:{})});}
    options.onDraft?.(part());
  }
  armature.querySelector('#fk-bone-add').onclick=()=>edit(d=>{const parent=bone(),p=part(),id='bone_'+crypto.randomUUID().replaceAll('-','').slice(0,16),head=parent?{...parent.tail}:{x:p?.x??0,y:(p?.y??0)-(p?.height??60)/2};d.bones.push({id,name:i18nText('modeler.boneDefault'),parent:parent?.id??null,connected:!!parent,head,tail:{x:head.x,y:head.y+Math.max(12,p?.height??60)}});activeBone=id;boneSelection.clear();boneSelection.add(id);boneAnchor=id;});
  armature.querySelector('#fk-bone-delete').onclick=removeBones;
  armature.querySelector('#fk-bone-bind').onclick=()=>edit(()=>{for(const p of selectedParts())p.bone=activeBone;});
  armature.querySelector('#fk-bone-unbind').onclick=()=>edit(()=>{for(const p of selectedParts())p.bone=null;});
  armature.querySelector('#fk-bone-color').onchange=e=>{const color=e.target.value;edit(d=>{for(const b of d.bones)if(boneSelection.has(b.id))b.color=color;});};
  bindAttribute(armature.querySelector('#fk-bone-list'),'title',()=>i18nText('modeler.boneTreeHint'));
  armature.querySelector('#fk-bone-form').onsubmit=e=>{e.preventDefault();const name=armature.querySelector('#fk-bone-name').value.trim();if(!name)return;const coordinates=Object.fromEntries(['headX','headY','tailX','tailY'].map(key=>[key,Number(armature.querySelector('#fk-bone-'+key).value)]));edit(d=>editBone(d,activeBone,{name,color:armature.querySelector('#fk-bone-color').value,parent:armature.querySelector('#fk-bone-parent').value||null,connected:armature.querySelector('#fk-bone-connected').checked,head:{x:coordinates.headX,y:coordinates.headY},tail:{x:coordinates.tailX,y:coordinates.tailY}}));};
  function renderTree(){
    reconcileSelection();const scroll=tree.scrollTop,focused=tree.contains(document.activeElement),focusId=document.activeElement.closest?.('[data-layer]')?.dataset.layer,focusAction=document.activeElement.dataset?.layerAction;tree.replaceChildren();
    const add=(parent,depth)=>{for(const {kind,value:p}of layerChildren(doc,parent)){
      const row=document.createElement('div');row.className='fk-layer-row';row.dataset.layer=p.id;row.dataset.kind=kind;row.style.setProperty('--depth',depth);row.draggable=!busy;row.setAttribute('role','treeitem');row.setAttribute('aria-selected',String(selection.has(p.id)));row.setAttribute('aria-level',String(depth+1));
      const eye=document.createElement('button');eye.type='button';eye.disabled=busy;eye.dataset.layerAction='visible';eye.className='fk-layer-eye';eye.innerHTML=modelIcon(p.visible?'eye':'eyeOff');eye.setAttribute('aria-pressed',String(p.visible));bindAttribute(eye,'title',()=>i18nText(p.visible?'modeler.hide':'modeler.show'));bindAttribute(eye,'aria-label',()=>i18nText(p.visible?'modeler.hide':'modeler.show'));row.append(eye);
      if(kind==='group'){const toggle=document.createElement('button');toggle.type='button';toggle.dataset.layerAction='collapse';toggle.className='fk-layer-fold';toggle.innerHTML=modelIcon(collapsed.has(p.id)?'expand':'collapse');bindAttribute(toggle,'aria-label',()=>i18nText(collapsed.has(p.id)?'modeler.expand':'modeler.collapse'));row.append(toggle);row.setAttribute('aria-expanded',String(!collapsed.has(p.id)));}
      const icon=document.createElement('span');icon.className='fk-layer-thumb';icon.innerHTML=modelIcon(kind==='group'?'group':'part');const src=doc.textures[p.id]||doc.sequences[p.id]?.frames[0];if(src&&kind==='part'){const image=document.createElement('img');image.src=src;image.alt='';icon.replaceChildren(image);}row.append(icon);
      const grip=document.createElement('span');grip.className='fk-layer-grip';grip.innerHTML=modelIcon('drag');grip.setAttribute('aria-hidden','true');row.append(grip);
      const name=document.createElement('span');name.className='fk-layer-name';name.dataset.i18nSkip='';name.textContent=p.name;row.append(name);row.classList.toggle('fk-layer-muted',!p.visible);tree.append(row);
      if(kind==='group'&&!collapsed.has(p.id))add(p.id,depth+1);
    }};add(null,0);
    const drop=document.createElement('div');drop.className='fk-layer-root';drop.dataset.rootDrop='';bindText(drop,()=>i18nText('modeler.rootDrop'));tree.append(drop);tree.scrollTop=scroll;
    const g=group(),properties=sidebar.querySelector('#fk-part-properties'),groupPanel=sidebar.querySelector('#fk-group-properties');properties.hidden=!!g||!part()||boneMode();groupPanel.hidden=!g||boneMode();sidebar.querySelector('#fk-part-assets').hidden=!!g;bindText(sidebar.querySelector('#fk-inspector-context'),()=>boneMode()?i18nText('modeler.armature'):selectedParts().length>1?i18nText('modeler.multiSelected',{count:selectedParts().length}):i18nText(g?'modeler.groupInspector':'modeler.partInspector'));
    if(g){const input=sidebar.querySelector('#fk-group-name');if(document.activeElement!==input)input.value=g.name;bindText(sidebar.querySelector('#fk-group-info'),()=>i18nText('modeler.groupSelected',{count:layerParts(doc,g.id).length}));}
    renderBones();
    sidebar.querySelector('#fk-group-add').disabled=busy||!preset||doc.groups.length>=32;
    if(focused){const row=[...tree.querySelectorAll('[data-layer]')].find(row=>row.dataset.layer===focusId),target=focusAction?row?.querySelector(`[data-layer-action="${focusAction}"]`):tree;(target&&!target.disabled?target:tree).focus({preventScroll:true});tree.scrollTop=scroll;}
  }
  function reconcileSelection(){for(const id of selection)if(!doc.layers.includes(id))selection.delete(id);if(!selection.has(selected))selected=[...selection].at(-1)??null;}
  function chooseMany(ids,primary=null,notify=true){const values=[...ids];selection.clear();for(const id of values)if(doc.layers.includes(id))selection.add(id);selected=selection.has(primary)?primary:[...selection].at(-1)??null;cropDraft=null;cropHover=null;cropInverted=part()?.mask?.inverted??false;renderTree();if(notify&&part())options.onSelect?.(selected);draw();}
  function choose(id,notify=true,toggle=false){layerAnchor=id;const ids=toggle?new Set(selection):new Set();if(toggle&&ids.has(id))ids.delete(id);else if(id)ids.add(id);chooseMany(ids,id,notify);}
  function chooseLayerRange(id,add=false){
    const rows=[...tree.querySelectorAll('[data-layer]')].map(row=>row.dataset.layer),a=rows.indexOf(layerAnchor),b=rows.indexOf(id);
    chooseMany(a<0?[id]:[...(add?selection:[]),...rows.slice(Math.min(a,b),Math.max(a,b)+1)],id);
    layerAnchor??=id;
  }
  function chooseBones(ids,primary=null){boneSelection.clear();for(const id of ids)if(doc.bones.some(b=>b.id===id))boneSelection.add(id);activeBone=boneSelection.has(primary)?primary:[...boneSelection].at(-1)??null;renderBones();draw();}
  function chooseBone(id,toggle=false,range=false){
    const list=armature.querySelector('#fk-bone-list'),rows=[...list.querySelectorAll('[data-bone-id]')].map(row=>row.dataset.boneId),a=rows.indexOf(boneAnchor),b=rows.indexOf(id),ids=new Set(toggle?boneSelection:[]);
    if(range&&a>=0){for(const value of rows.slice(Math.min(a,b),Math.max(a,b)+1))ids.add(value);}
    else {if(toggle&&ids.has(id))ids.delete(id);else if(id)ids.add(id);boneAnchor=id;}
    chooseBones([...ids],id);
  }
  async function removeBones(){await edit(d=>{for(const id of [...boneSelection])removeBone(d,id);});}
  function copyBones(){const ids=new Set([...boneSelection].flatMap(id=>[...boneDescendants(doc.bones,id)]));boneClipboard=copyDocument(doc.bones.filter(b=>ids.has(b.id)));inform();}
  async function pasteBones(){if(!boneClipboard?.length||doc.bones.length+boneClipboard.length>128)return;await edit(d=>{
    const ids=new Map(boneClipboard.map(b=>[b.id,'bone_'+crypto.randomUUID().replaceAll('-','').slice(0,16)])),parent=bone()?.parent??null,at=Math.max(0,d.bones.findIndex(b=>b.id===activeBone)+1);
    const values=boneClipboard.map(b=>({...copyDocument(b),id:ids.get(b.id),parent:ids.get(b.parent)??parent,connected:b.connected&&ids.has(b.parent),head:{x:b.head.x+12,y:b.head.y+12},tail:{x:b.tail.x+12,y:b.tail.y+12}}));
    d.bones.splice(at,0,...values);boneSelection.clear();for(const b of values)boneSelection.add(b.id);activeBone=values.at(-1).id;
  });}
  const boneList=armature.querySelector('#fk-bone-list');let boneBox=null,boneClickSuppressed=false;
  boneList.addEventListener('click',e=>{if(boneClickSuppressed){boneClickSuppressed=false;return;}if(busy)return;const row=e.target.closest('[data-bone-id]');if(!row){chooseBones([]);return;}const id=row.dataset.boneId,action=e.target.closest('[data-bone-action]')?.dataset.boneAction;
    if(action==='collapse'){boneCollapsed.has(id)?boneCollapsed.delete(id):boneCollapsed.add(id);renderBones();}
    else if(action==='visible')edit(d=>{const b=d.bones.find(b=>b.id===id);b.visible=!b.visible;});
    else {chooseBone(id,e.ctrlKey||e.metaKey,e.shiftKey);boneList.focus({preventScroll:true});}
  });
  boneList.addEventListener('pointerdown',e=>{if(!e.shiftKey||e.button!==0||busy||e.target.closest('button'))return;e.preventDefault();const rect=document.createElement('div');rect.className='fk-model-marquee';rect.style.setProperty('--nl-accent-blue',getComputedStyle(root).getPropertyValue('--nl-accent-blue'));document.body.append(rect);boneBox={x:e.clientX,y:e.clientY,startId:e.target.closest('[data-bone-id]')?.dataset.boneId,old:[...boneSelection],base:e.ctrlKey||e.metaKey?[...boneSelection]:[],moved:false,rect,rows:[...boneList.querySelectorAll('[data-bone-id]')].map(row=>({id:row.dataset.boneId,r:row.getBoundingClientRect()}))};boneList.setPointerCapture(e.pointerId);});
  boneList.addEventListener('pointermove',e=>{const b=boneBox;if(!b)return;b.moved ||= Math.hypot(e.clientX-b.x,e.clientY-b.y)>4;if(!b.moved)return;const left=Math.min(b.x,e.clientX),top=Math.min(b.y,e.clientY),right=Math.max(b.x,e.clientX),bottom=Math.max(b.y,e.clientY);Object.assign(b.rect.style,{left:left+'px',top:top+'px',width:right-left+'px',height:bottom-top+'px'});boneSelection.clear();for(const id of b.base)boneSelection.add(id);for(const row of b.rows)if(row.r.left<=right&&row.r.right>=left&&row.r.top<=bottom&&row.r.bottom>=top)boneSelection.add(row.id);activeBone=[...boneSelection].at(-1)??null;for(const row of boneList.querySelectorAll('[data-bone-id]'))row.setAttribute('aria-selected',String(boneSelection.has(row.dataset.boneId)));draw();});
  function endBoneBox(cancelled=false){if(!boneBox)return;const b=boneBox;boneBox=null;b.rect.remove();if(cancelled)chooseBones(b.old);else if(!b.moved&&b.startId)chooseBone(b.startId,b.base.length>0,true);else chooseBones([...boneSelection],activeBone);boneClickSuppressed=true;setTimeout(()=>{boneClickSuppressed=false;},0);}
  boneList.addEventListener('pointerup',()=>endBoneBox());boneList.addEventListener('pointercancel',()=>endBoneBox(true));boneList.addEventListener('lostpointercapture',()=>endBoneBox(true));
  const clearBoneDrop=()=>{for(const row of boneList.querySelectorAll('[data-drop]'))delete row.dataset.drop;};
  const boneDrop=e=>{const row=e.target.closest('[data-bone-id]');if(!row)return {id:null,position:'inside',row:boneList.querySelector('[data-bone-root]')};const r=row.getBoundingClientRect(),y=(e.clientY-r.top)/r.height;return {id:row.dataset.boneId,position:y<.25?'before':y>.75?'after':'inside',row};};
  boneList.addEventListener('dragstart',e=>{const row=e.target.closest('[data-bone-id]');if(busy||boneBox||!row||e.target.closest('button')){e.preventDefault();return;}boneDrag=row.dataset.boneId;if(!boneSelection.has(boneDrag)){boneSelection.clear();boneSelection.add(boneDrag);activeBone=boneDrag;}e.dataTransfer.setData('application/x-fk-bone',boneDrag);e.dataTransfer.effectAllowed='move';for(const row of boneList.querySelectorAll('[data-bone-id]')){row.setAttribute('aria-selected',String(boneSelection.has(row.dataset.boneId)));row.classList.toggle('fk-layer-dragging',boneSelection.has(row.dataset.boneId));}});
  boneList.addEventListener('dragover',e=>{if(!boneDrag)return;e.preventDefault();clearBoneDrop();const drop=boneDrop(e);if(drop.row)drop.row.dataset.drop=drop.position;e.dataTransfer.dropEffect='move';});
  boneList.addEventListener('drop',e=>{if(!boneDrag)return;e.preventDefault();const drop=boneDrop(e);boneDrag=null;clearBoneDrop();edit(d=>{moveBones(d,boneSelection,drop.id,drop.position);});});
  boneList.addEventListener('dragend',()=>{boneDrag=null;clearBoneDrop();for(const row of boneList.querySelectorAll('.fk-layer-dragging'))row.classList.remove('fk-layer-dragging');});

  function fit(){if(!w||!h)return;const bounds=[...doc.rig.flatMap(p=>[world(p,-p.width/2,-p.height/2),world(p,p.width/2,-p.height/2),world(p,-p.width/2,p.height/2),world(p,p.width/2,p.height/2)]),...(boneMode()?doc.bones.flatMap(b=>[b.head,b.tail]):[])],a=Math.min(...bounds.map(p=>p.x)),b=Math.max(...bounds.map(p=>p.x)),d=Math.min(...bounds.map(p=>p.y)),e=Math.max(...bounds.map(p=>p.y));zoom=clamp(Math.min((w-110)/Math.max(1,b-a),(h-100)/Math.max(1,e-d)),.000001,3);cx=w/2-(a+b)*zoom/2;cy=h/2-(d+e)*zoom/2;draw();}
  function resize(){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const first=!w;cx+=(r.width-w)/2;cy+=(r.height-h)/2;w=r.width;h=r.height;canvas.width=Math.round(w*Math.min(devicePixelRatio||1,2));canvas.height=Math.round(h*Math.min(devicePixelRatio||1,2));first?fit():draw();}
  async function loadImages(){const v=++revision,result=preset?await loadPuppetImages({...preset,...doc}):null;if(v===revision){images=result;draw();}}
  async function commit(before,history=true){
    if(sameModelDocument(before,doc))return true;
    try{doc=modelDocument(doc);}catch(error){doc=before;reconcileSelection();renderTree();if(part())options.onSelect?.(selected);options.onError?.(error);draw();return false;}
    busy=true;draw();renderTree();let ok=false;try{ok=!!await options.onCommit(copyDocument(doc));}catch(error){options.onError?.(error);}
    if(ok){if(history){undo.push(before);if(undo.length>40)undo.shift();redo.length=0;}}else doc=before;
    busy=false;reconcileSelection();renderTree();if(part())options.onSelect?.(selected);if(!sameModelAssets(before,doc))loadImages();draw();return ok;
  }
  async function edit(change){if(busy||gesture||!preset)return false;const before=copyDocument(doc),next=change(doc);if(next)doc=next;return commit(before);}
  async function history(back){if(busy||gesture)return;const from=back?undo:redo,to=back?redo:undo;if(!from.length)return;const before=copyDocument(doc),next=from.pop();doc=copyDocument(next);cropDraft=null;cropHover=null;cropInverted=part()?.mask?.inverted??false;if(await commit(before,false))to.push(before);else from.push(next);draw();}
  function copy(){if(!preset)return;const members=selectedParts(),ids=new Set([...selection].flatMap(id=>doc.groups.some(g=>g.id===id)?[...groupIds(doc,id)]:[]));if(!members.length&&!ids.size)return;clipboard={root:selected,roots:selectionRoots(doc,selection),bones:copyDocument(doc.bones.filter(b=>members.some(p=>p.bone===b.id))),rig:copyDocument(members),groups:copyDocument(doc.groups.filter(g=>ids.has(g.id))),layers:doc.layers.filter(id=>ids.has(id)||members.some(p=>p.id===id)),textures:Object.fromEntries(members.filter(p=>doc.textures[p.id]).map(p=>[p.id,doc.textures[p.id]])),sequences:copyDocument(Object.fromEntries(members.filter(p=>doc.sequences[p.id]).map(p=>[p.id,doc.sequences[p.id]])))};if(members.some(p=>p.id==='head')&&!clipboard.textures.head&&!clipboard.sequences.head&&images?.avatar){const surface=document.createElement('canvas');surface.width=images.avatar.width;surface.height=images.avatar.height;surface.getContext('2d').drawImage(images.avatar,0,0);clipboard.textures.head=surface.toDataURL('image/png');}inform();}
  async function paste(){
    if(!clipboard||doc.rig.length+clipboard.rig.length>24||doc.groups.length+clipboard.groups.length>32||doc.bones.length+clipboard.bones.length>128)return;
    await edit(d=>{const data=copyDocument(clipboard),ids=new Map([...data.rig,...data.groups].map(p=>[p.id,'part_'+crypto.randomUUID().replaceAll('-','').slice(0,16)])),boneIds=new Map(data.bones.map(b=>[b.id,'bone_'+crypto.randomUUID().replaceAll('-','').slice(0,16)])),destination=(group()?group().parent:part()?.group)||null;
      for(const b of data.bones){const parent=boneIds.get(b.parent)||(d.bones.some(bone=>bone.id===b.parent)?b.parent:null);d.bones.push({...b,id:boneIds.get(b.id),parent,connected:b.connected&&boneIds.has(b.parent),head:{x:b.head.x+12,y:b.head.y+12},tail:{x:b.tail.x+12,y:b.tail.y+12}});}
      for(const g of data.groups)d.groups.push({...g,id:ids.get(g.id),parent:ids.get(g.parent)||destination});
      d.layers.splice(Math.max(0,d.layers.indexOf(selected)),0,...data.layers.map(id=>ids.get(id)));
      for(const p of data.rig){const id=ids.get(p.id);d.rig.push({...p,id,bone:boneIds.get(p.bone)??null,x:p.x+12,y:p.y+12,parent:ids.get(p.parent)||(d.rig.some(q=>q.id===p.parent)?p.parent:null),group:ids.get(p.group)||destination});if(data.textures[p.id])d.textures[id]=data.textures[p.id];if(data.sequences[p.id])d.sequences[id]=data.sequences[p.id];}
      selection.clear();for(const id of data.roots)selection.add(ids.get(id));selected=ids.get(data.root);layerAnchor=selected;return flattenLayers(d);
    });
  }
  async function remove(){if(boneMode()){await removeBones();return;}await edit(d=>removeLayers(d,selection));}
  async function newGroup(){if(doc.groups.length>=32)return;await edit(d=>{const roots=selectionRoots(d,selection),p=part(),g=group(),id='group_'+crypto.randomUUID().replaceAll('-','').slice(0,16),parents=roots.map(id=>d.rig.find(p=>p.id===id)?.group??d.groups.find(g=>g.id===id)?.parent??null),parent=roots.length===1&&g?g.id:parents.every(id=>id===parents[0])?(parents[0]??null):null;d.groups.push({id,name:i18nText('modeler.groupDefault'),parent,visible:true});d.layers.splice(roots.length?Math.min(...roots.map(id=>d.layers.indexOf(id))):0,0,id);for(const item of roots){const child=d.rig.find(p=>p.id===item),childGroup=d.groups.find(g=>g.id===item);if(child)child.group=id;else if(childGroup&&childGroup.id!==parent)childGroup.parent=id;}selection.clear();selection.add(id);selected=id;return flattenLayers(d);});}
  async function addPart(name,anchor=selected){const id='part_'+crypto.randomUUID().replaceAll('-','').slice(0,16);if(doc.rig.length>=24)return false;const ok=await edit(d=>addModelPart(d,name,id,anchor));if(ok&&doc.rig.some(p=>p.id===id))choose(id);return ok;}
  function setTool(value){tool=value;cropDraft=null;cropHover=null;cropInverted=part()?.mask?.inverted??false;
    const p=part();if(value==='crop'&&p?.mask){cropMode='polygon';root.querySelector('#fk-crop-mode').value=cropMode;cropDraft={points:maskDisplayPoints(p,-p.width/2,-p.height/2,p.width,p.height),closed:true};}
    canvas.style.cursor=['crop','bone'].includes(value)?'crosshair':'default';renderTree();draw();}
  async function cropApply(){
    const p=part(),a=cropDraft;if(!p||!a)return;
    if(a.points||cropInverted){
      let mask;try{mask=normalizeShapeMask({inverted:cropInverted,points:cropPoints(a).map(v=>{let x=v.x/p.width+.5,y=v.y/p.height+.5;if(p.flipX)x=1-x;if(p.flipY)y=1-y;return {x:clamp(p.crop.x+x*p.crop.width,0,1),y:clamp(p.crop.y+y*p.crop.height,0,1)};})});}catch(error){options.onError?.(error);return;}
      if(await edit(()=>{p.mask=mask;}))setTool('move');return;
    }
    if(a.width<1||a.height<1)return;
    const ok=await edit(()=>{const x=(a.x+p.width/2)/p.width,y=(a.y+p.height/2)/p.height,sx=a.width/p.width,sy=a.height/p.height,old=p.crop;p.crop={x:old.x+(p.flipX?1-x-sx:x)*old.width,y:old.y+(p.flipY?1-y-sy:y)*old.height,width:old.width*sx,height:old.height*sy};const center=world(p,a.x+a.width/2,a.y+a.height/2);p.x=center.x;p.y=center.y;p.width=Math.max(6,a.width);p.height=Math.max(6,a.height);});if(ok)setTool('move');
  }
  async function resetCrop(id){if(id===selected){cropDraft=null;cropHover=null;cropInverted=false;}return edit(d=>{const p=d.rig.find(p=>p.id===id);if(!p)return;const crop=p.crop,width=Math.max(6,p.width/crop.width),height=Math.max(6,p.height/crop.height),offset=world(p,(.5-crop.x-crop.width/2)*width*(p.flipX?-1:1),(.5-crop.y-crop.height/2)*height*(p.flipY?-1:1));Object.assign(p,{width,height,x:offset.x,y:offset.y,crop:{x:0,y:0,width:1,height:1},mask:null});});}
  root.querySelector('#fk-crop-mode').onchange=e=>{cropMode=e.target.value;cropDraft=null;cropHover=null;draw();};
  function invertCrop(){cropInverted=!cropInverted;if(!cropDraft&&part()?.mask)edit(()=>{part().mask.inverted=cropInverted;});draw();}
  root.querySelector('#fk-crop-invert').onchange=invertCrop;
  root.querySelector('#fk-crop-clear').onclick=()=>{cropDraft=null;cropHover=null;draw();};
  const actions={undo:()=>history(true),redo:()=>history(false),fit,move:()=>setTool('move'),crop:()=>setTool('crop'),bone:()=>setTool('bone'),pose:()=>setTool('pose'),cropApply,copy:()=>boneMode()?copyBones():copy(),paste:()=>boneMode()?pasteBones():paste(),duplicate:()=>{if(boneMode()){copyBones();return pasteBones();}copy();return paste();},cut:async()=>{boneMode()?copyBones():copy();await remove();},delete:remove};
  for(const button of root.querySelectorAll('[data-act]'))button.onclick=()=>actions[button.dataset.act]?.();
  tree.addEventListener('click',e=>{if(suppressTreeClick){suppressTreeClick=false;return;}const row=e.target.closest('[data-layer]');if(busy)return;if(!row){if(!e.ctrlKey&&!e.metaKey)choose(null);return;}const id=row.dataset.layer,action=e.target.closest('[data-layer-action]')?.dataset.layerAction;if(action==='visible')edit(d=>{const p=d.rig.find(p=>p.id===id)||d.groups.find(g=>g.id===id);p.visible=!p.visible;});else if(action==='collapse'){collapsed.has(id)?collapsed.delete(id):collapsed.add(id);renderTree();}else{if(e.shiftKey)chooseLayerRange(id,e.ctrlKey||e.metaKey);else choose(id,true,e.ctrlKey||e.metaKey);tree.focus({preventScroll:true});}});
  tree.addEventListener('dragstart',e=>{const row=e.target.closest('[data-layer]');if(!row||busy||treeBox||e.target.closest('button')){e.preventDefault();return;}dragId=row.dataset.layer;if(!selection.has(dragId)){selection.clear();selection.add(dragId);selected=dragId;for(const row of tree.querySelectorAll('[data-layer]'))row.setAttribute('aria-selected',String(selection.has(row.dataset.layer)));draw();}e.dataTransfer.setData('application/x-fk-layer',dragId);e.dataTransfer.effectAllowed='move';for(const row of tree.querySelectorAll('[aria-selected=true]'))row.classList.add('fk-layer-dragging');});
  tree.addEventListener('pointerdown',e=>{if(!e.shiftKey||e.button!==0||busy||e.target.closest('button'))return;e.preventDefault();const rect=document.createElement('div');rect.className='fk-model-marquee';rect.style.setProperty('--nl-accent-blue',getComputedStyle(root).getPropertyValue('--nl-accent-blue'));document.body.append(rect);treeBox={x:e.clientX,y:e.clientY,old:[...selection],anchor:layerAnchor,startId:e.target.closest('[data-layer]')?.dataset.layer,moved:false,base:e.ctrlKey||e.metaKey?[...selection]:[],rect,rows:[...tree.querySelectorAll('[data-layer]')].map(row=>({id:row.dataset.layer,r:row.getBoundingClientRect()}))};tree.setPointerCapture(e.pointerId);});
  tree.addEventListener('pointermove',e=>{if(!treeBox)return;const b=treeBox;b.moved ||= Math.hypot(e.clientX-b.x,e.clientY-b.y)>4;if(!b.moved)return;const l=Math.min(b.x,e.clientX),t=Math.min(b.y,e.clientY),r=Math.max(b.x,e.clientX),bottom=Math.max(b.y,e.clientY);Object.assign(b.rect.style,{left:l+'px',top:t+'px',width:r-l+'px',height:bottom-t+'px'});selection.clear();for(const id of b.base)selection.add(id);for(const row of b.rows)if(row.r.left<=r&&row.r.right>=l&&row.r.top<=bottom&&row.r.bottom>=t)selection.add(row.id);selected=[...selection].at(-1)??null;for(const row of tree.querySelectorAll('[data-layer]'))row.setAttribute('aria-selected',String(selection.has(row.dataset.layer)));draw();});
  const endTreeBox=(cancelled=false)=>{if(!treeBox)return;const state=treeBox,ids=cancelled?state.old:[...selection];state.rect.remove();treeBox=null;if(!cancelled&&!state.moved&&state.startId){chooseLayerRange(state.startId,state.base.length>0);suppressTreeClick=true;setTimeout(()=>{suppressTreeClick=false;},0);return;}suppressTreeClick=true;setTimeout(()=>{suppressTreeClick=false;},0);chooseMany(ids,selected);};
  tree.addEventListener('pointerup',()=>endTreeBox());tree.addEventListener('pointercancel',()=>endTreeBox(true));tree.addEventListener('lostpointercapture',()=>endTreeBox(true));
  const clearDrop=()=>{for(const row of tree.querySelectorAll('[data-drop]'))delete row.dataset.drop;};
  const dropPosition=e=>{const row=e.target.closest('[data-layer]');if(!row)return {id:null,position:'inside',row:tree.querySelector('[data-root-drop]')};const r=row.getBoundingClientRect(),y=(e.clientY-r.top)/r.height;return {id:row.dataset.layer,position:row.dataset.kind==='group'&&y>.25&&y<.75?'inside':y<.5?'before':'after',row};};
  tree.addEventListener('dragover',e=>{if(!dragId)return;e.preventDefault();clearDrop();const d=dropPosition(e);d.row.dataset.drop=d.position;e.dataTransfer.dropEffect='move';});
  tree.addEventListener('drop',e=>{e.preventDefault();if(!dragId)return;const d=dropPosition(e),id=dragId;dragId=null;clearDrop();edit(doc=>moveLayers(doc,selection.has(id)?selection:[id],d.id,d.position));});
  tree.addEventListener('dragend',()=>{dragId=null;clearDrop();for(const row of tree.querySelectorAll('.fk-layer-dragging'))row.classList.remove('fk-layer-dragging');});
  sidebar.querySelector('#fk-group-add').onclick=newGroup;
  sidebar.querySelector('#fk-group-form').onsubmit=e=>{e.preventDefault();const name=sidebar.querySelector('#fk-group-name').value.trim();if(name)edit(()=>{group().name=name;});};
  sidebar.querySelector('#fk-group-ungroup').onclick=()=>edit(d=>removeLayer(d,selected,true));
  canvas.addEventListener('pointerdown',e=>{
    if(busy||!preset)return;canvas.focus();const q=point(e),p=part();
    if(boneMode()&&(e.ctrlKey||e.metaKey)&&e.button===0){const hit=boneHit(q);if(hit){chooseBone(hit.b.id,true);return;}}
    if(e.button===1||e.button===0&&space){gesture={pan:true,x:e.clientX,y:e.clientY,cx,cy};e.preventDefault();}
    else if(e.button===0){
      if(tool==='crop'&&p){
        const at=cropPoint(p,q);
        if(cropMode==='polygon'){
          if(e.detail>=2&&cropDraft?.points?.length>=3){cropDraft.closed=true;cropHover=null;draw();return;}
          if(!cropDraft?.points)cropDraft={points:[],closed:false};
          const index=cropDraft.points.findIndex(v=>Math.hypot(v.x-at.x,v.y-at.y)<8/zoom);
          if(index===0&&!cropDraft.closed&&cropDraft.points.length>=3){cropDraft.closed=true;cropHover=null;draw();return;}
          if(index>=0){gesture={cropVertex:index,start:q,old:copyDocument(cropDraft)};canvas.setPointerCapture(e.pointerId);draw();return;}
          if(!cropDraft.closed&&cropDraft.points.length<256)cropDraft.points.push(at);cropHover=null;draw();return;
        }
        if(cropMode==='lasso'){const old=copyDocument(cropDraft);cropDraft={points:[at],closed:false};gesture={lasso:true,start:q,old};canvas.setPointerCapture(e.pointerId);draw();return;}
      }
      const handle=p&&!boneMode()&&selectedParts().length===1&&tool!=='crop'&&handles(p).find(v=>Math.hypot(v.x-q.x,v.y-q.y)<9/zoom);
      if(e.shiftKey&&!handle&&(!boneMode()||!boneHit(q))){gesture={marquee:true,bones:boneMode(),start:q,base:e.ctrlKey||e.metaKey?[...(boneMode()?boneSelection:selection)]:[],old:[...(boneMode()?boneSelection:selection)],box:{left:q.x,right:q.x,top:q.y,bottom:q.y}};}
      else if(boneMode()&&!e.ctrlKey&&!e.metaKey){if(!startBoneGesture(q))return;}
      else{
        const selectedHit=selectedParts().find(p=>contains(p,q)),hit=handle?p:((e.ctrlKey||e.metaKey||e.altKey)?null:selectedHit)||resolvedRig({...doc,bones:undefined}).reverse().find(p=>p.visible&&p.opacity>0&&contains(p,q));
        if(e.ctrlKey||e.metaKey){if(hit)choose(hit.id,true,true);return;}
        if(!hit){choose(null);return;}
        if(!selectedParts().some(p=>p.id===hit.id)&&!handle)choose(hit.id);
        const actual=part(),members=selectedParts();
        if(!handle&&tool==='move'&&(members.length>1||group()))gesture={before:copyDocument(doc),start:q,parts:copyDocument(members)};
        else{gesture={before:copyDocument(doc),start:q,part:copyDocument(actual),handle,crop:tool==='crop'};if(gesture.crop){cropDraft=null;gesture.startLocal=local(actual,q);}}
      }
    }else return;canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!gesture){if(tool==='crop'&&cropDraft?.points&&!cropDraft.closed&&part()){cropHover=cropPoint(part(),point(e));draw();}return;}if(gesture.pan){cx=gesture.cx+e.clientX-gesture.x;cy=gesture.cy+e.clientY-gesture.y;draw();return;}
    const q=point(e),g=gesture,p=part(),a=g.part;
    if(g.cropVertex!==undefined){cropDraft.points[g.cropVertex]=cropPoint(p,q);draw();return;}
    if(g.lasso){const at=cropPoint(p,q),last=cropDraft.points.at(-1);if(Math.hypot(at.x-last.x,at.y-last.y)>2/zoom){if(cropDraft.points.length>=256)cropDraft.points=cropDraft.points.filter((_,i)=>i%2===0);cropDraft.points.push(at);}draw();return;}
    if(g.marquee){g.box={left:Math.min(q.x,g.start.x),right:Math.max(q.x,g.start.x),top:Math.min(q.y,g.start.y),bottom:Math.max(q.y,g.start.y)};if(g.bones){boneSelection.clear();for(const id of g.base)boneSelection.add(id);for(const b of doc.bones)if(boneVisible(b)&&partIntersectsBox({x:(b.head.x+b.tail.x)/2,y:(b.head.y+b.tail.y)/2,width:Math.hypot(b.tail.x-b.head.x,b.tail.y-b.head.y),height:10/zoom,rotation:Math.atan2(b.tail.y-b.head.y,b.tail.x-b.head.x)*180/Math.PI},g.box))boneSelection.add(b.id);activeBone=[...boneSelection].at(-1)??null;for(const row of boneList.querySelectorAll('[data-bone-id]'))row.setAttribute('aria-selected',String(boneSelection.has(row.dataset.boneId)));draw();return;}selection.clear();for(const id of g.base)selection.add(id);for(const p of resolvedRig({...doc,bones:undefined}))if(p.visible&&p.opacity>0&&partIntersectsBox(p,g.box))selection.add(p.id);selected=[...selection].at(-1)??null;for(const row of tree.querySelectorAll('[data-layer]'))row.setAttribute('aria-selected',String(selection.has(row.dataset.layer)));draw();return;}
    if(g.bone){moveBoneGesture(q,e);draw();return;}
    if(g.parts){const dx=q.x-g.start.x,dy=q.y-g.start.y;for(const original of g.parts){const p=doc.rig.find(p=>p.id===original.id);p.x=original.x+dx;p.y=original.y+dy;}options.onDraft?.(part());draw();return;}
    if(g.crop){const ql=local(a,q),x=clamp(Math.min(g.startLocal.x,ql.x),-a.width/2,a.width/2),y=clamp(Math.min(g.startLocal.y,ql.y),-a.height/2,a.height/2);cropDraft={x,y,width:clamp(Math.max(g.startLocal.x,ql.x),x,a.width/2)-x,height:clamp(Math.max(g.startLocal.y,ql.y),y,a.height/2)-y};draw();return;}
    if(g.handle?.dy===-2){const delta=(Math.atan2(q.y-a.y,q.x-a.x)-Math.atan2(g.start.y-a.y,g.start.x-a.x))*180/Math.PI;let angle=a.rotation+delta;if(e.shiftKey)angle=Math.round(angle/15)*15;p.rotation=((angle+540)%360)-180;}
    else if(g.handle){const start=local(a,g.start),now=local(a,q),h=g.handle;let sx=a.width+(now.x-start.x)*h.dx,sy=a.height+(now.y-start.y)*h.dy;if(e.shiftKey){const scale=Math.max(Math.abs(sx/a.width-1)>Math.abs(sy/a.height-1)?Math.abs(sx/a.width):Math.abs(sy/a.height),Math.max(6/a.width,6/a.height));if(h.dx)sx=Math.sign(sx||1)*a.width*scale;if(h.dy)sy=Math.sign(sy||1)*a.height*scale;if(!h.dx)sx=a.width*scale;if(!h.dy)sy=a.height*scale;}const signedX=Math.sign(sx||1)*Math.max(Math.abs(sx),6),signedY=Math.sign(sy||1)*Math.max(Math.abs(sy),6),center=world(a,h.dx*(signedX-a.width)/2,h.dy*(signedY-a.height)/2);p.width=Math.abs(signedX);p.height=Math.abs(signedY);p.x=center.x;p.y=center.y;p.flipX=a.flipX!==(sx<0);p.flipY=a.flipY!==(sy<0);}
    else{p.x=a.x+q.x-g.start.x;p.y=a.y+q.y-g.start.y;}options.onDraft?.(p);draw();
  });
  canvas.addEventListener('pointerup',()=>{if(!gesture)return;const g=gesture;gesture=null;if(g.lasso){cropDraft.closed=true;cropHover=null;draw();return;}if(g.cropVertex!==undefined){draw();return;}if(g.marquee){g.bones?chooseBones([...boneSelection],activeBone):chooseMany(selection,selected);return;}if(!g.pan&&!g.crop)commit(g.before);draw();});
  function cancel(){if(gesture?.before){doc=gesture.before;options.onDraft?.(part());}if(gesture?.marquee){gesture.bones?chooseBones(gesture.old):chooseMany(gesture.old);}gesture=null;cropDraft=null;cropHover=null;draw();}
  canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',()=>{if(gesture)cancel();});
  canvas.addEventListener('wheel',e=>{e.preventDefault();const p=point(e),r=canvas.getBoundingClientRect();zoom=clamp(zoom*Math.exp(-e.deltaY*.001),.000001,5);cx=e.clientX-r.left-p.x*zoom;cy=e.clientY-r.top-p.y*zoom;draw();},{passive:false});
  function keydown(e){if(e.target.closest('input,textarea,select,[contenteditable="true"]')||busy||!preset)return;const key=e.key.toLowerCase(),ctrl=e.ctrlKey||e.metaKey;if(key==='escape'){e.preventDefault();if(boneBox){endBoneBox(true);return;}if(treeBox){endTreeBox(true);return;}if(gesture||cropDraft)cancel();else if(boneMode())chooseBones([]);else choose(null);return;}if(gesture)return;if(tool==='crop'&&ctrl&&e.shiftKey&&key==='i'){e.preventDefault();invertCrop();return;}if(tool==='crop'&&cropDraft?.points&&!ctrl&&(key==='backspace'||key==='delete')){e.preventDefault();cropDraft.points.pop();cropDraft.closed=false;cropHover=null;if(!cropDraft.points.length)cropDraft=null;draw();return;}let act;if(ctrl){act=({t:'move',c:'copy',x:'cut',v:'paste',j:'duplicate',z:e.shiftKey?'redo':'undo',y:'redo'})[key];if(key==='a'){e.preventDefault();if(boneMode())chooseBones(doc.bones.map(b=>b.id));else chooseMany(doc.rig.map(p=>p.id));return;}if(key==='g'&&!boneMode()){e.preventDefault();e.shiftKey?edit(d=>removeLayer(d,selected,true)):newGroup();return;}}else act=({v:'move',c:'crop',b:'bone',p:'pose',f:'fit',delete:'delete',backspace:'delete',enter:'cropApply'})[key];if(act){e.preventDefault();e.stopPropagation();actions[act]();return;}if(key===' '){space=true;e.preventDefault();return;}if(key.startsWith('arrow')&&boneMode()&&boneSelection.size){e.preventDefault();const step=e.shiftKey?10:1,dx=(key==='arrowleft'?-step:key==='arrowright'?step:0),dy=(key==='arrowup'?-step:key==='arrowdown'?step:0);edit(d=>{if(tool==='pose'){for(const id of boneRoots(d.bones,boneSelection))poseBone(d,id,0,dx,dy);}else translateBones(d,boneSelection,dx,dy);});return;}if(key.startsWith('arrow')&&selectedParts().length){e.preventDefault();const delta=e.shiftKey?10:1;edit(()=>{for(const p of selectedParts()){p.x+=(key==='arrowleft'?-delta:key==='arrowright'?delta:0);p.y+=(key==='arrowup'?-delta:key==='arrowdown'?delta:0);}options.onDraft?.(part());});}}
  const keyup=e=>{if(e.key===' ')space=false;},blur=()=>{space=false;if(gesture)cancel();endTreeBox(true);endBoneBox(true);};root.addEventListener('keydown',keydown);sidebar.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
  const unsubscribe=onLanguageChange(()=>{renderTree();draw();}),observer=new ResizeObserver(resize);observer.observe(canvas);function tick(){if(!root.hidden&&images&&Object.keys(images.sequences).length)draw();animation=requestAnimationFrame(tick);}animation=requestAnimationFrame(tick);
  return {getSelection(){return {id:selected,ids:[...selection],kind:group()?'group':part()?'part':null};},select(id){if(!group())this.selectPart(id);},selectPart(id){if(doc.rig.some(p=>p.id===id))choose(id,false);},refresh(){resize();draw();},edit,remove,resetCrop,addPart,patchPart(id,patch){return edit(d=>{Object.assign(d.rig.find(p=>p.id===id),patch);});},async setPreset(value){
      if(value===lastValue)return;
      const changed=preset?.id!==value?.id,avatarChanged=preset?.avatar!==value?.avatar;preset=value;
      if(changed){boneBox?.rect.remove();boneBox=null;treeBox?.rect.remove();treeBox=null;undo.length=redo.length=0;collapsed.clear();selected=null;selection.clear();activeBone=null;boneSelection.clear();boneCollapsed.clear();layerAnchor=boneAnchor=null;gesture=null;cropDraft=null;}
      if(!changed&&(busy||gesture))return;
      const next=modelDocument(value||{});lastValue=value;
      if(!changed&&!avatarChanged&&sameModelDocument(next,doc))return;
      const reload=changed||avatarChanged||!sameModelAssets(next,doc);doc=next;
      reconcileSelection();renderTree();draw();if(changed)fit();if(reload)await loadImages();
    },dispose(){boneBox?.rect.remove();treeBox?.rect.remove();cancelAnimationFrame(animation);observer.disconnect();unsubscribe();root.removeEventListener('keydown',keydown);sidebar.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);}};
}
