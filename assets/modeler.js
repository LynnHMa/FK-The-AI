import {t as i18nText,h as i18nHtml,bindText} from './i18n.js';
import { normalizeRig, loadPuppetImages, frameAt } from './puppet.js';

// Edits a local draft; a gesture commits one validated rig, never one request per pixel.
export function createModeler(root, options) {
  root.innerHTML=`<header class="fk-modeler-toolbar"><div><b>${i18nHtml("modeler.004")}</b><small>${i18nHtml("modeler.005")}</small></div><button data-act="undo" title="${i18nHtml("modeler.001")}">${i18nHtml("weapon_editor.016")}</button><button data-act="redo" title="${i18nHtml("modeler.002")}">${i18nHtml("weapon_editor.017")}</button><button data-act="fit">${i18nHtml("modeler.006")}</button></header><canvas id="fk-model-canvas" tabindex="0" aria-label="${i18nHtml("modeler.003")}"></canvas><footer><span id="fk-model-info">${i18nHtml("modeler.007")}</span><span>${i18nHtml("modeler.008")}</span></footer>`;
  const canvas=root.querySelector('canvas'),c=canvas.getContext('2d'),undo=[],redo=[];
  let preset=null,rig=normalizeRig(),selected='torso',images=null,zoom=1,cx=0,cy=0,w=0,h=0,gesture=null,busy=false,revision=0,animation=0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),clone=()=>rig.map(p=>({...p}));
  const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left-cx)/zoom,y:(e.clientY-r.top-cy)/zoom};};
  const handles=p=>[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]].map(([x,y])=>({x:p.x+x*p.width/2,y:p.y+y*p.height/2,dx:x,dy:y}));
  function inform(){const p=rig.find(p=>p.id===selected);bindText(root.querySelector('#fk-model-info'),()=>p?`${p.name}   ${Math.round(p.width)} × ${Math.round(p.height)}   (${Math.round(p.x)}, ${Math.round(p.y)})`:i18nText("modeler.009"), "textContent");root.querySelector('[data-act="undo"]').disabled=busy||!undo.length;root.querySelector('[data-act="redo"]').disabled=busy||!redo.length;}
  function draw(){
    if(!w||!h)return;const ratio=Math.min(devicePixelRatio||1,2);c.setTransform(ratio,0,0,ratio,0,0);c.clearRect(0,0,w,h);
    const style=getComputedStyle(root),color=k=>style.getPropertyValue(k).trim();
    c.fillStyle=color('--nl-bg');c.fillRect(0,0,w,h);c.save();c.translate(cx,cy);c.scale(zoom,zoom);
    c.strokeStyle=color('--nl-border');c.lineWidth=1/zoom;
    const left=-cx/zoom,right=(w-cx)/zoom,top=-cy/zoom,bottom=(h-cy)/zoom;
    for(let x=Math.floor(left/20)*20;x<right;x+=20){c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();}
    for(let y=Math.floor(top/20)*20;y<bottom;y+=20){c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();}
    c.strokeStyle=color('--nl-text-faint');c.beginPath();c.moveTo(0,top);c.lineTo(0,bottom);c.moveTo(left,0);c.lineTo(right,0);c.stroke();
    c.setLineDash([4/zoom,4/zoom]);for(const p of rig){const parent=rig.find(q=>q.id===p.parent);if(parent){c.beginPath();c.moveTo(p.x,p.y);c.lineTo(parent.x,parent.y);c.stroke();}}c.setLineDash([]);
    for(const p of rig){
      const texture=images&&(frameAt(images.skins,images.sequences,p.id,performance.now()/1000)||(p.id==='head'?images.avatar:null));
      if(texture)c.drawImage(texture,p.x-p.width/2,p.y-p.height/2,p.width,p.height);
      else {c.fillStyle=color('--nl-surface-hover');c.strokeStyle=color('--nl-text-muted');c.beginPath();c.roundRect(p.x-p.width/2,p.y-p.height/2,p.width,p.height,Math.min(6,p.width/4));c.fill();c.stroke();if(p.id==='head'){c.fillStyle=color('--nl-text');c.fillRect(p.x-12,p.y-7,5,4);c.fillRect(p.x+7,p.y-7,5,4);}}
      if(p.id!==selected){c.fillStyle=color('--nl-text-muted');c.font=`${10/zoom}px system-ui`;c.textAlign='center';c.fillText(p.name,p.x,p.y+p.height/2+12/zoom);}
    }
    const p=rig.find(p=>p.id===selected);if(p){c.strokeStyle=color('--nl-accent-blue');c.lineWidth=1.5/zoom;c.strokeRect(p.x-p.width/2,p.y-p.height/2,p.width,p.height);for(const q of handles(p)){c.fillStyle=color('--nl-surface');c.fillRect(q.x-4/zoom,q.y-4/zoom,8/zoom,8/zoom);c.strokeRect(q.x-4/zoom,q.y-4/zoom,8/zoom,8/zoom);}c.beginPath();c.arc(p.x,p.y,2.5/zoom,0,Math.PI*2);c.stroke();}
    c.restore();inform();
  }
  function fit(){if(!w||!h)return;const a=Math.min(...rig.map(p=>p.x-p.width/2)),b=Math.max(...rig.map(p=>p.x+p.width/2)),d=Math.min(...rig.map(p=>p.y-p.height/2)),e=Math.max(...rig.map(p=>p.y+p.height/2));zoom=clamp(Math.min((w-110)/(b-a),(h-100)/(e-d)),.3,3);cx=w/2-(a+b)*zoom/2;cy=h/2-(d+e)*zoom/2;draw();}
  function resize(){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const first=!w;cx+=(r.width-w)/2;cy+=(r.height-h)/2;w=r.width;h=r.height;canvas.width=Math.round(w*Math.min(devicePixelRatio||1,2));canvas.height=Math.round(h*Math.min(devicePixelRatio||1,2));first?fit():draw();}
  function choose(id){selected=id;options.onSelect?.(id);draw();}
  async function commit(before,history=true){
    if(JSON.stringify(before)===JSON.stringify(rig))return;
    let next;try{next=normalizeRig(rig);}catch(e){rig=before;draw();return;}
    busy=true;draw();const ok=await options.onCommit(next);busy=false;
    if(ok){if(history){undo.push(before);if(undo.length>40)undo.shift();redo.length=0;}}
    else rig=before;
    draw();
  }
  async function history(back){if(busy||gesture)return;const from=back?undo:redo,to=back?redo:undo;if(!from.length)return;const before=clone(),next=from.pop();rig=next.map(p=>({...p}));busy=true;draw();const ok=await options.onCommit(rig);busy=false;if(ok)to.push(before);else{rig=before;from.push(next);}draw();}
  canvas.addEventListener('pointerdown',e=>{
    if(busy||!preset)return;canvas.focus();const q=point(e),p=rig.find(p=>p.id===selected);const handle=p&&handles(p).find(v=>Math.hypot(v.x-q.x,v.y-q.y)<9/zoom);
    if(e.button===1){gesture={pan:true,x:e.clientX,y:e.clientY,cx,cy};e.preventDefault();}
    else if(e.button===0){const hit=handle?p:[...rig].reverse().find(p=>Math.abs(p.x-q.x)<=p.width/2&&Math.abs(p.y-q.y)<=p.height/2);if(!hit)return;choose(hit.id);gesture={before:clone(),start:q,part:{...hit},handle};}
    else return;canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!gesture)return;if(gesture.pan){cx=gesture.cx+e.clientX-gesture.x;cy=gesture.cy+e.clientY-gesture.y;draw();return;}
    const q=point(e),g=gesture,p=rig.find(p=>p.id===selected),dx=q.x-g.start.x,dy=q.y-g.start.y;
    if(g.handle){const a=g.part,h=g.handle;for(const [axis,size,delta,dir,min,max] of [['x','width',dx,h.dx,-260,260],['y','height',dy,h.dy,-210,210]]){if(!dir)continue;const v=clamp(a[size]+dir*delta,6,220);p[size]=Math.round(v);p[axis]=clamp(Math.round(a[axis]+dir*(v-a[size])/2),min,max);}}
    else{p.x=clamp(Math.round(g.part.x+dx),-260,260);p.y=clamp(Math.round(g.part.y+dy),-210,210);}
    options.onDraft?.(p);draw();
  });
  canvas.addEventListener('pointerup',()=>{if(!gesture)return;const g=gesture;gesture=null;if(!g.pan)commit(g.before);});
  const cancel=()=>{if(gesture?.before){rig=gesture.before;options.onDraft?.(rig.find(p=>p.id===selected));}gesture=null;draw();};
  canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);
  canvas.addEventListener('wheel',e=>{e.preventDefault();const p=point(e),r=canvas.getBoundingClientRect();zoom=clamp(zoom*Math.exp(-e.deltaY*.001),.3,5);cx=e.clientX-r.left-p.x*zoom;cy=e.clientY-r.top-p.y*zoom;draw();},{passive:false});
  canvas.addEventListener('keydown',e=>{
    if(busy||gesture)return;if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();history(!e.shiftKey);return;}
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const before=clone(),p=rig.find(p=>p.id===selected),delta=e.shiftKey?10:1;if(!p)return;p.x=clamp(p.x+(e.key==='ArrowLeft'?-delta:e.key==='ArrowRight'?delta:0),-260,260);p.y=clamp(p.y+(e.key==='ArrowUp'?-delta:e.key==='ArrowDown'?delta:0),-210,210);options.onDraft?.(p);draw();commit(before);
  });
  root.querySelector('[data-act="undo"]').onclick=()=>history(true);root.querySelector('[data-act="redo"]').onclick=()=>history(false);root.querySelector('[data-act="fit"]').onclick=fit;
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  function tick(){if(!root.hidden&&images&&Object.keys(images.sequences).length)draw();animation=requestAnimationFrame(tick);}animation=requestAnimationFrame(tick);
  return {select(id){selected=id;draw();},refresh(){resize();draw();},async setPreset(value){
    const changed=preset?.id!==value?.id;if(changed){undo.length=redo.length=0;}preset=value;
    if(!gesture)rig=normalizeRig(value?.rig);if(!rig.some(p=>p.id===selected))selected=rig[0].id;
    draw();if(changed)fit();const v=++revision;const result=value?await loadPuppetImages(value):null;if(v===revision){images=result;draw();}
  },dispose(){cancelAnimationFrame(animation);observer.disconnect();}};
}
