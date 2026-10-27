import {GRAPH_LIMITS} from './weapon-graph.js';
import {createValueResolver} from './weapon-values.js';
const TAU=Math.PI*2,rad=d=>d*Math.PI/180,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

// A bounded, event-driven interpreter for weapon graphs. No built-in dispatch,
// timers, code evaluation, DOM, or platform-specific graphics live here.
export function createWeaponRuntime(host){
 let time=0,held=false,heldAt=0,pointer={x:350,y:240},previous={...pointer},selected=null,selectedProgram=null,active=true;
 let entities=[],regions=[],jobs=[],visuals=[],statuses=[],beams=[],serial=0,launches=0,dropped=0,frameBudget=GRAPH_LIMITS.events;
 const values=createValueResolver();
 const resolved=(program,node,event)=>({...node,params:values.resolve(program,node,event,{time,pointer})});
 const triggers=new Map(),programs=new Map(),textures=new Map();
 const valid=b=>b&&host.valid(b),bodies=()=>host.bodies().filter(valid);
 const options=(program,event={})=>{const node=program?.settingsNode;return node?values.resolve(program,node,event,{time,pointer}):{damage:1,force:1,rate:1,volume:1,pitch:1,soundEvent:'original'};};
 const modifiers=(program,event={})=>{const base=host.modifiers?.(program.id)||{damage:1,force:1,rate:1},extra=options(program,event);return {...extra,damage:base.damage*extra.damage,force:base.force*extra.force,rate:base.rate*extra.rate};};
 function compile(w){const signature=JSON.stringify(w.graph),old=programs.get(w.id);if(old?.signature===signature)return old;const p={id:w.id,signature,nodes:new Map(w.graph.nodes.map(n=>[n.id,n])),settingsNode:w.graph.nodes.find(n=>n.type==='weaponSettings'),outputs:new Map(),inputs:new Map(),roots:w.graph.nodes.filter(n=>n.type==='trigger')};for(const l of w.graph.links){if(l.param!==undefined){if(!p.inputs.has(l.to))p.inputs.set(l.to,[]);p.inputs.get(l.to).push(l);continue;}const key=l.from+':'+l.port;if(!p.outputs.has(key))p.outputs.set(key,[]);p.outputs.get(key).push(l.to);}programs.set(w.id,p);return p;}
 const nearest=p=>bodies().reduce((best,b)=>!best||Math.hypot(b.x-p.x,b.y-p.y)<Math.hypot(best.x-p.x,best.y-p.y)?b:best,null);
 function location(params,event){if(params.origin==='pointer')return {...pointer};if(params.origin==='muzzle')return host.muzzle();if(params.origin==='target'){const b=valid(event.target)?event.target:nearest(event);if(b)return {x:b.x,y:b.y};}return {x:event.x,y:event.y};}
 function direction(params,event,at){let a=event.angle||0;if(params.aim==='pointer')a=Math.atan2(pointer.y-at.y,pointer.x-at.x);else if(params.aim==='nearest'){const b=nearest(at);if(b)a=Math.atan2(b.y-at.y,b.x-at.x);}else if(params.aim==='fixed')a=0;return a+rad(params.angle||0);}
 const context=(p,n,event,extra={})=>({...event,...extra,program:p,from:n.id});
 function out(program,node,port,event,depth=0){for(const to of program.outputs.get(node.id+':'+port)||[])run(program,to,{...event},depth+1);}
 function queue(job){if(jobs.length>=GRAPH_LIMITS.tasks){dropped++;return;}jobs.push(job);}
 function run(program,id,event,depth=0){
  if(depth>GRAPH_LIMITS.depth||frameBudget--<=0){dropped++;return;}const source=program.nodes.get(id);if(!source)return;const node=resolved(program,source,event),p=node.params;
  if(node.type==='trigger'){out(program,node,'fire',event,depth);return;}
  if(node.type==='setVariable'){values.write(program.id,p);out(program,node,'next',event,depth);return;}
  if(node.type==='delay'){for(let i=0;i<p.repeat;i++)queue({at:time+p.seconds+i*p.interval,program,node,event,depth});return;}
  if(node.type==='gate'){const yes=p.condition==='chance'?Math.random()<p.threshold:p.condition==='charge'?(event.charge||0)>=p.threshold:p.condition==='speed'?(event.speed||0)/3000>=p.threshold:p.condition==='fragment'?!!event.target?.fragment:event.target?.name==='head';out(program,node,yes?'yes':'no',event,depth);return;}
  if(node.type==='effect'){
   const b=event.target;if(!valid(b))return;const m=modifiers(program,event),strength=event.strength||1;
   if(p.kind==='damage')host.damage(b,p.amount*m.damage*strength,event,program.id,m);
   if(p.kind==='impulse'){
    let dx=Math.cos(event.angle||0),dy=Math.sin(event.angle||0);
    if(p.direction==='in'||p.direction==='out'){dx=b.x-event.centerX;dy=b.y-event.centerY;if(!Number.isFinite(dx)||Math.hypot(dx,dy)<1){dx=Math.cos(event.angle||0);dy=Math.sin(event.angle||0);}if(p.direction==='in'){dx=-dx;dy=-dy;}}
    if(p.direction==='up'){dx=0;dy=-1;}if(p.direction==='down'){dx=0;dy=1;}
    if(p.direction==='pointer'){dx=pointer.x-b.x;dy=pointer.y-b.y;}
    if(p.direction==='tangent'){const a=Math.atan2(b.y-(event.centerY??event.y),b.x-(event.centerX??event.x))+Math.PI/2;dx=Math.cos(a);dy=Math.sin(a);}
    const length=Math.hypot(dx,dy)||1;host.impulse(b,dx/length*p.force*m.force*strength,dy/length*p.force*m.force*strength);
   }
   if(p.kind==='paint')host.paint(b,event,p);
   if(p.kind==='cut')host.cut(b,event);if(p.kind==='shatter')host.shatter(b,event);
   if(p.kind==='stun'||p.kind==='burn'){if(statuses.length<192)statuses.push({kind:p.kind,target:b,until:time+p.duration,next:time,params:p,event,program});else dropped++;}
   out(program,node,'next',event,depth);return;
  }
  if(node.type==='visual'){
   if(visuals.length<192)visuals.push({...event,params:p,age:0});else dropped++;
   host.feedback?.(event,p.shake);out(program,node,'next',event,depth);return;
  }
  const at=location(p,event),a=direction(p,event,at),base=context(program,node,event,{x:at.x,y:at.y,centerX:at.x,centerY:at.y,angle:a});
  if(node.type==='projectile'){
   launches++;host.launch?.(program.id,options(program,event));for(let i=0;i<p.count;i++){
    if(entities.length>=GRAPH_LIMITS.entities){dropped++;break;}
    const offset=p.pattern==='ring'?TAU*i/p.count:p.pattern==='parallel'?0:p.pattern==='random'?(Math.random()-.5)*rad(p.spread):p.count>1?(i/(p.count-1)-.5)*rad(p.spread):0;
    const angle=a+offset,parallel=p.pattern==='parallel'?(i-(p.count-1)/2)*p.spacing:0;
    const text=p.words==='swears'?host.word?.():p.text;if(p.words==='swears'&&!text)continue;
    const e={id:++serial,program,node,params:p,event:base,x:at.x-Math.sin(a)*parallel,y:at.y+Math.cos(a)*parallel,baseX:at.x-Math.sin(a)*parallel,baseY:at.y+Math.cos(a)*parallel,vx:Math.cos(angle)*p.speed,vy:Math.sin(angle)*p.speed,angle,age:0,bounces:p.bounce,pierce:p.pierce,hit:new Set(),ignoreBody:event.skipTarget,trail:[],text};
    entities.push(e);out(program,node,'spawn',{...base,x:e.x,y:e.y,angle,speed:p.speed},depth);
   }return;
  }
  if(node.type==='beam'){launches++;host.launch?.(program.id,options(program,event));for(let i=0;i<p.count;i++)cast(program,node,base,a+(p.count>1?(i/(p.count-1)-.5)*rad(p.spread):0),depth);return;}
  if(node.type==='area'){
   if(regions.length>=128){dropped++;return;}const r={program,node,event:base,x:at.x,y:at.y,age:0,next:time};regions.push(r);scan(r,depth);r.next=time+p.interval;
  }
 }
 function wallRay(at,ux,uy,range=Infinity){const b=host.bounds();let length=range,wall=false,axis='';for(const [edge,dir,start,key]of [[ux>=0?b.right:b.left,ux,at.x,'x'],[uy>=0?b.bottom:b.top,uy,at.y,'y']]){if(Math.abs(dir)<1e-8)continue;const t=(edge-start)/dir;if(t>=0&&t<length){length=t;wall=true;axis=key;}}if(!Number.isFinite(length))length=0;return {x:at.x+ux*length,y:at.y+uy*length,length,wall,axis};}
 function cast(program,node,event,angle,depth){
  const p=node.params,seen=new Set();let start={x:event.x,y:event.y},terminalPoint=start,remaining=p.range||Infinity,left=p.pierce+1;
  for(let bounce=0;bounce<=p.bounce&&left>0;bounce++){
   const ux=Math.cos(angle),uy=Math.sin(angle),end=wallRay(start,ux,uy,remaining),contacts=host.contacts(start,end).filter(h=>!seen.has(h.b.id));let terminal=end;
   for(const h of contacts){if(left--<=0)break;seen.add(h.b.id);out(program,node,'hit',{...event,x:h.x,y:h.y,target:h.b,angle,speed:3000,skipTarget:h.b.id},depth);if(left<=0){terminal=h;break;}}
   terminalPoint={x:terminal.x,y:terminal.y};if(beams.length<128)beams.push({a:start,b:terminalPoint,params:p,age:0});
   if(terminal!==end)break;
   if(end.wall)out(program,node,'wall',{...event,x:end.x,y:end.y,target:null,angle},depth);
   if(!end.wall||bounce===p.bounce)break;remaining-=end.length;if(remaining<=0)break;
   if(end.axis==='x')angle=Math.PI-angle;else angle=-angle;start={x:end.x+Math.cos(angle)*.1,y:end.y+Math.sin(angle)*.1};
  }
  out(program,node,'end',{...event,...terminalPoint,target:null,angle},depth);
 }
 function scan(r,depth=0){
  const p=r.node.params,event={...r.event,x:r.x,y:r.y,centerX:r.x,centerY:r.y};out(r.program,r.node,'tick',event,depth);
  for(const b of bodies())if(host.overlaps(b,r.x,r.y,p))out(r.program,r.node,'hit',{...event,x:b.x,y:b.y,target:b,angle:Math.atan2(b.y-r.y,b.x-r.x)},depth);
 }
 function trigger(mode,charge=0){if(!selected||!active)return;const program=selectedProgram,m=modifiers(program,{...pointer,charge});for(const node of program.roots){const p=resolved(program,node,{...pointer,charge, speed:Math.hypot(pointer.x-previous.x,pointer.y-previous.y)}).params,key=program.id+':'+node.id;if(p.mode!==mode||time-(triggers.get(key)??-Infinity)<p.interval/(m.rate||1))continue;triggers.set(key,time);const amount=clamp(charge/p.charge,0,1);run(program,node.id,{...pointer,angle:Math.atan2(pointer.y-previous.y,pointer.x-previous.x),charge:amount,strength:mode==='release'?1+amount*(p.chargeGain-1):1,target:host.hitAt(pointer.x,pointer.y),centerX:pointer.x,centerY:pointer.y});}}
 function finish(e,reason,event){if(e.dead)return;e.dead=true;if(reason==='wall')out(e.program,e.node,'wall',{...e.event,...event,target:null});out(e.program,e.node,'end',{...e.event,...event,target:null});}
 function update(dt){
  if(!active)return;time+=dt;frameBudget=GRAPH_LIMITS.events;if(held)trigger('hold');
  const due=jobs.filter(j=>j.at<=time);jobs=jobs.filter(j=>j.at>time);for(const j of due){let e={...j.event};if(j.node.params.follow==='pointer')e={...e,...pointer};if(j.node.params.follow==='target'&&valid(e.target))e={...e,x:e.target.x,y:e.target.y};out(j.program,j.node,'fire',e,j.depth);}
  for(const s of statuses){if(!valid(s.target)||time>=s.until)continue;if(s.kind==='stun'){const f=Math.exp(-dt*35);s.target.vx*=f;s.target.vy*=f;s.target.va*=f;s.target.stun=Math.max(s.target.stun||0,.12);}else if(time>=s.next){s.next=time+s.params.interval;host.damage(s.target,s.params.amount*modifiers(s.program,s.event).damage*(s.event.strength||1),{...s.event,x:s.target.x,y:s.target.y},s.program.id,modifiers(s.program,s.event));}}
  statuses=statuses.filter(s=>time<s.until&&valid(s.target));
  // New emissions run next step, giving every frame a predictable work budget.
  for(const e of [...entities]){
   if(e.dead)continue;const p=e.params;e.age+=dt;const last={x:e.x,y:e.y};
   if(e.age>=p.life){finish(e,'expire',{...last,angle:e.angle,speed:Math.hypot(e.vx,e.vy)});continue;}
   if(p.homing){const b=nearest(e);if(b){const speed=Math.hypot(e.vx,e.vy),a=Math.atan2(e.vy,e.vx),next=a+angleDelta(a,Math.atan2(b.y-e.y,b.x-e.x))*Math.min(1,p.homing*dt);e.vx=Math.cos(next)*speed;e.vy=Math.sin(next)*speed;}}
   const speed=Math.hypot(e.vx,e.vy),next=Math.min(6000,Math.max(0,speed+p.acceleration*dt));if(speed){e.vx*=next/speed;e.vy*=next/speed;}else if(next){e.vx=Math.cos(e.angle)*next;e.vy=Math.sin(e.angle)*next;}e.vy+=p.gravity*dt;if(e.vx||e.vy)e.angle=Math.atan2(e.vy,e.vx);
   e.baseX+=e.vx*dt;e.baseY+=e.vy*dt;const wave=p.wave*Math.sin(e.age*p.frequency*TAU),orbit=p.orbit,phase=e.age*p.spin;
   let end={x:e.baseX-Math.sin(e.angle)*wave+orbit*(Math.cos(phase)-1),y:e.baseY+Math.cos(e.angle)*wave+orbit*Math.sin(phase)};
   const bounds=host.bounds();let axis='';if(end.x<bounds.left||end.x>bounds.right)axis='x';if(end.y<bounds.top||end.y>bounds.bottom)axis=axis?'xy':'y';end.x=clamp(end.x,bounds.left,bounds.right);end.y=clamp(end.y,bounds.top,bounds.bottom);
   let stopped=false;const contacts=host.contacts(last,end);if(e.ignoreBody&&!contacts.some(h=>h.b.id===e.ignoreBody))e.ignoreBody=null;for(const h of contacts){if(e.hit.has(h.b.id)||h.b.id===e.ignoreBody)continue;e.hit.add(h.b.id);out(e.program,e.node,'hit',{...e.event,x:h.x,y:h.y,target:h.b,angle:e.angle,speed:Math.hypot(e.vx,e.vy),skipTarget:h.b.id});if(e.pierce--<=0){finish(e,'hit',{x:h.x,y:h.y,angle:e.angle,skipTarget:h.b.id});stopped=true;break;}}
   if(stopped)continue;e.x=end.x;e.y=end.y;
   if(axis){out(e.program,e.node,'wall',{...e.event,...end,angle:e.angle,target:null});if(e.bounces-->0){if(axis.includes('x'))e.vx=-e.vx;if(axis.includes('y'))e.vy=-e.vy;e.baseX=e.x;e.baseY=e.y;}else finish(e,'edge',{...end,angle:e.angle});}
   if(p.trail){e.trail.push({x:e.x,y:e.y,t:time});e.trail=e.trail.filter(t=>time-t.t<p.trail).slice(-48);}
  }
  entities=entities.filter(e=>!e.dead);
  for(const r of [...regions]){const p=r.node.params;r.age+=dt;if(p.follow==='pointer'){r.x=pointer.x;r.y=pointer.y;}else if(p.follow==='target'&&valid(r.event.target)){r.x=r.event.target.x;r.y=r.event.target.y;}if(r.age>=p.duration){r.dead=true;out(r.program,r.node,'end',{...r.event,x:r.x,y:r.y,target:null});}else if(time>=r.next){r.next=time+p.interval;scan(r);}}
  regions=regions.filter(r=>!r.dead);for(const v of visuals)v.age+=dt;visuals=visuals.filter(v=>v.age<v.params.life);for(const b of beams)b.age+=dt;beams=beams.filter(b=>b.age<b.params.life);
 }
 function polygon(c,points){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();}
 function texture(src){if(!src||!host.image)return null;if(!textures.has(src)){textures.set(src,null);host.image(src).then(img=>{textures.set(src,img);}).catch(()=>{});}return textures.get(src);}
 function draw(c){
  c.save();for(const r of regions){const p=r.node.params;c.save();c.translate(r.x,r.y);c.strokeStyle=p.color;c.fillStyle=p.color;c.globalAlpha=.09;c.beginPath();if(p.shape==='box')c.rect(-p.radius,-p.height/2,p.radius*2,p.height);else if(p.shape==='cone'){c.moveTo(0,0);c.arc(0,0,p.radius,rad(p.angle-p.arc/2),rad(p.angle+p.arc/2));c.closePath();}else c.arc(0,0,p.radius,0,TAU);c.fill();c.globalAlpha=.65;c.lineWidth=1.5;c.setLineDash([6,5]);c.stroke();c.restore();}
  for(const b of beams){c.save();c.strokeStyle=b.params.color;c.globalAlpha=1-b.age/b.params.life;c.lineWidth=b.params.width;c.lineCap='round';c.beginPath();c.moveTo(b.a.x,b.a.y);c.lineTo(b.b.x,b.b.y);c.stroke();c.restore();}
  for(const e of entities){const p=e.params;c.save();c.strokeStyle=p.color;c.fillStyle=p.color;c.lineWidth=Math.max(1,p.size*.25);if(e.trail.length>1){c.globalAlpha=.35;c.beginPath();e.trail.forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));c.stroke();c.globalAlpha=1;}c.translate(e.x,e.y);c.rotate(e.angle);const size=p.size;
   if(p.shape==='text'){c.rotate(-e.angle);c.font=`800 ${size*2}px "Microsoft YaHei", "Noto Sans SC", sans-serif`;c.textAlign='center';c.fillText(p.words==='swears'?host.mask(e.text):e.text,0,0);}
   else if(p.shape==='sprite'&&texture(p.texture)){const img=texture(p.texture);c.drawImage(img,-size,-size,size*2,size*2);}
   else if(p.shape==='star'){polygon(c,Array.from({length:10},(_,i)=>{const a=i*TAU/10,r=i%2?size*.4:size;return [Math.cos(a)*r,Math.sin(a)*r];}));c.fill();}
   else if(p.shape==='diamond'||p.shape==='needle'){polygon(c,[[size*(p.shape==='needle'?2:1),0],[0,size*.5],[-size,0],[0,-size*.5]]);c.fill();}
   else {c.beginPath();c.arc(0,0,size,0,TAU);p.shape==='ring'?c.stroke():c.fill();}c.restore();
  }
  for(const v of visuals){const p=v.params,t=v.age/p.life;c.save();c.translate(v.x,v.y);c.globalAlpha=1-t;c.strokeStyle=c.fillStyle=p.color;c.lineWidth=2;
   if(p.shape==='text'){c.font=`800 ${p.size}px "Microsoft YaHei", "Noto Sans SC", sans-serif`;c.textAlign='center';c.fillText(p.text,0,-t*40);}
   else if(p.shape==='ring'){c.beginPath();c.arc(0,0,Math.max(1,p.size*t),0,TAU);c.stroke();}
   else if(p.shape==='star'){c.rotate(v.age*3);polygon(c,Array.from({length:10},(_,i)=>{const a=i*TAU/10,r=p.size*(.5+t*.5)*(i%2?.35:1);return [Math.cos(a)*r,Math.sin(a)*r];}));c.stroke();}
   else {c.rotate(v.age*2);c.beginPath();for(let i=0;i<p.count;i++){const a=i*TAU/p.count,inner=p.size*t*.35,outer=p.size*t;c.moveTo(Math.cos(a)*inner,Math.sin(a)*inner);c.lineTo(Math.cos(a)*outer,Math.sin(a)*outer);}c.stroke();}c.restore();
  }c.restore();
 }
 function bounds(add,line){for(const e of entities){add(e.x,e.y,Math.max(e.params.size*2,e.params.shape==='text'?e.text.length*e.params.size*2:0)+5);for(const t of e.trail)add(t.x,t.y,e.params.size+4);}for(const r of regions)add(r.x,r.y,r.node.params.radius+5,Math.max(r.node.params.radius,r.node.params.height/2)+5);for(const v of visuals)add(v.x,v.y,v.params.size*(v.params.shape==='text'?v.params.text.length:1)+8);for(const b of beams)line(b.a,b.b,b.params.width+4);}
 function clear(){entities=[];regions=[];jobs=[];visuals=[];statuses=[];beams=[];triggers.clear();values.clear();held=false;launches=dropped=0;}
 return {
  configure(w){selected=w?.graph?w:null;selectedProgram=selected?compile(selected):null;const used=new Set([...entities.map(e=>e.program.id),...regions.map(r=>r.program.id),...jobs.map(j=>j.program.id),...statuses.map(s=>s.program.id),selected?.id]);for(const key of programs.keys())if(!used.has(key))programs.delete(key);const sources=new Set([...programs.values()].flatMap(p=>[...p.nodes.values()].map(n=>n.params.texture).filter(Boolean)));for(const key of textures.keys())if(!sources.has(key))textures.delete(key);},
  down(p){if(!active||!selected)return;frameBudget=GRAPH_LIMITS.events;previous={...pointer};pointer={...p};held=true;heldAt=time;for(const node of selectedProgram.roots)triggers.set(selected.id+':distance:'+node.id,{...p});trigger('press');trigger('hold');},
  move(p){previous={...pointer};pointer={...p};if(!held||!selected)return;const program=selectedProgram;for(const node of program.roots.filter(n=>n.params.mode==='drag')){const last=triggers.get(program.id+':distance:'+node.id)||previous;if(Math.hypot(p.x-last.x,p.y-last.y)>=resolved(program,node,{...p}).params.distance){trigger('drag');triggers.set(program.id+':distance:'+node.id,{...p});}}},
  up(p){if(!held)return;pointer={...p};trigger('release',time-heldAt);held=false;},cancel(){held=false;},setActive(v){active=!!v;if(!active)held=false;},update,draw,bounds,clear,
  snapshot(){return {entities:entities.map(e=>({id:e.id,node:e.node.id,x:e.x,y:e.y,vx:e.vx,vy:e.vy,age:e.age,shape:e.params.shape,color:e.params.color})),regions:regions.map(r=>({node:r.node.id,x:r.x,y:r.y,age:r.age,radius:r.node.params.radius})),pending:jobs.length,statuses:statuses.length,launches,dropped,held,visuals:visuals.length,beams:beams.length};}
 };
}
