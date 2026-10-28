import {t as i18nText} from './i18n.js';
import { createWeaponRuntime } from './weapon-runtime.js';
import { normalizeTheme, resolveTheme } from './themes.js';
import { normalizeRig, frameAt, validTexture, partsByLayer, drawPartImage, clipPart } from './puppet.js';
export { DEFAULT_RIG, normalizeRig, loadPuppetImages, MAX_TEXTURE_LENGTH, validTexture } from './puppet.js';
export { THEMES, THEME_COLOR_KEYS, normalizeTheme, resolveTheme } from './themes.js';
// Combat owns input, fixed-step physics and feedback; the host owns persistence.
import { WEAPONS, WEAPON_KEYS, weaponCatalog, normalizeWeapons } from './weapons.js';
import { normalizeDialogue, createDialogue } from './dialogue.js';
export { WEAPONS, WEAPON_KEYS, weaponCatalog } from './weapons.js';
export const BODY_PARTS = Object.freeze({get head(){return i18nText("combat.001");},get torso(){return i18nText("combat.002");},get leftArm(){return i18nText("combat.003");},get rightArm(){return i18nText("combat.004");},get leftLeg(){return i18nText("combat.005");},get rightLeg(){return i18nText("combat.006");}});

export const DEFAULT_SETTINGS = Object.freeze({
  theme: Object.freeze(normalizeTheme()), schemaVersion: 2, rope: Object.freeze({enabled:true,part:'',x:0,y:-.5,length:0}), power: 1, knockback: 1, rate: 1, gravity: 1, bounce: .48, toughness: 1,
  shake: .7, hitstop: 1, particles: 1, liquid: 25, liquidColor: '#38bdf8',
  volume: .45, targetScale: 1, slowMotion: 1, zoom: 1, recoil: 1, gunSpread: 1, energyFx: 1, flash: false, trails: true,
  swearMask: false, numbers: true, autoRebuild: false, modelName: '', particleTexture: '', particleSize: 1, particleLimit: 3000, liquidAlpha: 1, customWeapons: [], dialogue: normalizeDialogue(), weaponTuning: {}, weaponSounds: {}, pet: Object.freeze({enabled:true,x:null,y:null,desktopX:null,desktopY:null,speech:true,gravity:true})
});
const limits = { power: [.1,5], knockback: [0,3], rate: [.4,2.5], gravity: [0,2.5],
  bounce: [0,.95], toughness: [.25,4], shake: [0,1.5], hitstop: [0,2],
  particles: [0,2], liquid: [0,500], volume: [0,1], targetScale: [.65,1.4], slowMotion: [.25,1],
  zoom: [0,3], recoil: [0,2], gunSpread: [.2,2], energyFx: [0,2], particleSize: [.25,4], particleLimit: [500,6000], liquidAlpha:[0,1] };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function normalizeSettings(value = {}) {
  const out = { ...DEFAULT_SETTINGS, pet:{...DEFAULT_SETTINGS.pet},rope:{...DEFAULT_SETTINGS.rope},customWeapons:normalizeWeapons(value?.customWeapons),dialogue:normalizeDialogue(value?.dialogue),weaponSounds:{},swearWords:[],theme:normalizeTheme(value?.theme), weaponTuning: Object.fromEntries(Object.keys(WEAPONS).map(id=>[id,{}])) };
  if (!value || typeof value !== 'object') return out;
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) out[key] = clamp(value[key], min, max);
  }
  if(typeof value.rope?.enabled==='boolean')out.rope.enabled=value.rope.enabled;
  if(typeof value.rope?.part==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value.rope.part))out.rope.part=value.rope.part;
  for(const [key,min,max]of [['x',-.5,.5],['y',-.5,.5],['length',0,8000]])if(Number.isFinite(value.rope?.[key]))out.rope[key]=clamp(value.rope[key],min,max);
  for (const key of ['flash','trails','numbers','autoRebuild','swearMask']) if (typeof value[key] === 'boolean') out[key] = value[key];
  if (/^#[\da-f]{6}$/i.test(value.liquidColor)) out.liquidColor = value.liquidColor;
  if(validTexture(value.particleTexture))out.particleTexture=value.particleTexture;
  out.particleLimit=Math.round(out.particleLimit);
  if (typeof value.modelName === 'string') out.modelName = value.modelName.slice(0,80);
  for (const id of Object.keys(weaponCatalog(out))) {
    const tuning = value.weaponTuning?.[id];
    out.weaponTuning[id] = {};
    for (const key of ['damage','force','rate']) {
      if (typeof tuning?.[key] === 'number' && Number.isFinite(tuning[key])) out.weaponTuning[id][key] = clamp(tuning[key], .2, 3);
    }
  }
  let audioSize=0;
  for(const id of Object.keys(weaponCatalog(out))) {
    const sounds=value.weaponSounds?.[id],slots=typeof sounds==='string'?{attack:sounds}:sounds;
    for(const event of ['attack','hit','charge','release','miss']) {
      const src=slots?.[event];
      if(typeof src==='string'&&src.length<=1500000&&/^data:audio\/(?:mpeg|mp3|x-wav|wave|wav|ogg|webm|mp4|aac|flac);base64,[A-Za-z0-9+/=\r\n]+$/.test(src)&&audioSize+src.length<=20000000) {
        (out.weaponSounds[id]??={})[event]=src;audioSize+=src.length;
      }
    }
  }
  if(typeof value.pet?.enabled==='boolean')out.pet.enabled=value.pet.enabled;
  if(typeof value.pet?.speech==='boolean')out.pet.speech=value.pet.speech;
  if(typeof value.pet?.gravity==='boolean')out.pet.gravity=value.pet.gravity;
  for(const key of ['x','y'])if(Number.isFinite(value.pet?.[key]))out.pet[key]=clamp(value.pet[key],0,16000);
  for(const key of ['desktopX','desktopY'])if(Number.isFinite(value.pet?.[key]))out.pet[key]=clamp(value.pet[key],-16000,16000);
  out.swearWords=Array.isArray(value.swearWords)?value.swearWords.filter(x=>x&&typeof x.word==='string'&&x.word.length<=40&&Number.isFinite(x.count)&&x.count>0).slice(0,10000).map(x=>({word:x.word,count:Math.min(x.count,1000000000)})):[];
  return out;
}

export function createCombat(canvas, hooks = {}) {
  const platform=hooks.platform||globalThis;
  const window=platform.window,document=platform.document,Image=platform.Image,ResizeObserver=platform.ResizeObserver;
  const requestAnimationFrame=platform.requestAnimationFrame.bind(platform),cancelAnimationFrame=platform.cancelAnimationFrame.bind(platform);
  const ctx = canvas.getContext('2d');
  let settings = normalizeSettings(hooks.settings), weapon = 'fist', active = false;
  let catalog=weaponCatalog(settings),behavior='fist';
  const dialogue=createDialogue(()=>settings.dialogue);
  const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
  let palette=resolveTheme(settings.theme,systemTheme.matches);
  let width = 640, height = 520, scale = 1, offsetX = 0, offsetY = 0;
  let bodies = [], joints = [], particles = [], effects = [], numbers = [], stains = [], trails = [];
  let nextId = 0, target = null, model = 'deepseek-flash', combo = 0, comboLeft = 0;
  let suspension=null,weaponOrigin=null,ropePicking=false,weaponImages=[],weaponSources=[],weaponImageRevision=0;
  let input = null, pointer = {x:320,y:240}, clock = 0, freeze = 0, shake = 0, flash = 0;
  let lastTime = 0, accumulator = 0, raf = 0, cooldown = 0, rebuildAt = 0;
  let audio = null, noiseBuffer = null, master = null;
  const lastSounds=new Map();
  let targetEnabled = true, blasts = [], gunKick = 0, shots = 0, projectiles=[];
  let rig=normalizeRig(), sequences={};
  const soundBuffers=new Map(),playingSounds=new Set();
  let textures={}, particleImage=null, particleImageSource='', particleImageRevision=0;
  const alphaShapes=new WeakMap(),primitiveMasks=new Map();
  const camera = {x:0,y:0,vx:0,vy:0,zoom:0,zv:0,kick:0,focusX:350,focusY:260};
  const view = {x:0,y:0,zoom:1};
  let WORLD_W=700,WORLD_H=520,FLOOR=483,transparentSurface=false;
  const arenaBounds={left:12,right:688,top:16};
  const STEP=1/120;
  const cleanups = [];
  const listen = (obj, name, fn, options) => { obj.addEventListener(name, fn, options); cleanups.push(() => obj.removeEventListener(name, fn, options)); };
  let layerBodies=[],layersDirty=true;
  const orderedBodies=()=>{if(layersDirty){layerBodies=partsByLayer(bodies);layersDirty=false;}return layerBodies;};
  const alive = () => bodies.filter(b => !b.dead);
  const root = () => bodies.find(b => b.name === (rig.find(p=>p.parent===null)?.id||'torso') && !b.dead && !b.fragment);
  const tuning = (id=weapon) => settings.weaponTuning[id] || {};
  const spec = (id=weapon) => {const w=catalog[id]||WEAPONS.fist;return {...w,damage:w.damage*(tuning(id).damage??1),force:w.force*(tuning(id).force??1),interval:w.interval/settings.rate/(tuning(id).rate??1)};};
  const color=id=>behavior===id?catalog[weapon].color:WEAPONS[id].color;

  const custom=createWeaponRuntime({
    bodies:alive,valid:b=>!b.dead&&!bodyShape(b)?.empty,hitAt,contacts:rayContacts,
    bounds:()=>({...arenaBounds,bottom:FLOOR}),muzzle:()=>spriteGeometry()?.muzzle??{...gunOrigin()},
    modifiers:id=>({damage:tuning(id).damage??1,force:(tuning(id).force??1)*settings.knockback,rate:settings.rate*(tuning(id).rate??1)}),
    damage(b,amount,e,id,audioOptions){if(amount<=0)return;const dealt=recordDamage(b,amount,e.x,e.y,'',id);b.hp-=dealt/settings.power/settings.toughness;sound(id,1,false,'hit',audioOptions);},
    impulse(b,vx,vy){b.vx+=vx/Math.sqrt(b.mass);b.vy+=vy/Math.sqrt(b.mass);b.va+=(vx+vy)*.0003;},
    paint(b,e,p){const at=local(b,e.x,e.y);(b.paint??=[]).push({kind:'splat',x:at.x,y:at.y,r:p.size,color:p.color,angle:0});b.paint=b.paint.slice(-32);burst(e.x,e.y,p.amount,p.color,'liquid');},
    cut(b,e){for(const j of joints)if(j.alive&&(j.a===b||j.b===b))detach(j,e.x,e.y);},
    shatter(b,e){shatter(b,Math.cos(e.angle||0)*180,Math.sin(e.angle||0)*180);},
    feedback(e,strength){shake=Math.max(shake,strength*7*settings.shake);cameraPunch(strength,e.x,e.y);},
    launch(id,audioOptions){shots++;sound(id,1,false,'',audioOptions);},mask:text=>attackText(text),word(){const words=settings.swearWords||[];let pick=Math.random()*words.reduce((n,w)=>n+w.count,0);for(const w of words){pick-=w.count;if(pick<=0)return w.word;}return null;},
    image:src=>platform.loadImage?platform.loadImage(src):new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;}),
    overlaps(b,x,y,p){
      const contains=(wx,wy)=>{const dx=wx-x,dy=wy-y;if(p.shape==='box')return Math.abs(dx)<=p.radius&&Math.abs(dy)<=p.height/2;if(Math.hypot(dx,dy)>p.radius)return false;if(p.shape==='cone'){const a=Math.atan2(dy,dx)-p.angle*Math.PI/180;return Math.abs(Math.atan2(Math.sin(a),Math.cos(a)))<=p.arc*Math.PI/360;}return true;};
      const shape=bodyShape(b),k=deformation(b),bounds=bodyBounds(b);if(!bounds)return false;
      const ex=p.radius,ey=p.shape==='box'?p.height/2:p.radius;if(b.x+bounds.right<x-ex||b.x+bounds.left>x+ex||b.y+bounds.bottom<y-ey||b.y+bounds.top>y+ey)return false;
      // Sample inside the area too: a small blast fully inside an opaque region
      // must hit, while a blast wholly inside an alpha hole must not.
      for(let iy=-1;iy<=1;iy++)for(let ix=-1;ix<=1;ix++){const wx=x+ix*ex*.65,wy=y+iy*ey*.65;if(contains(wx,wy)&&segmentEntry(b,{x:wx,y:wy},{x:wx,y:wy})!==null)return true;}
      if(shape){for(let i=0;i<shape.edge.length;i+=2){const point=worldAnchor(b,shape.edge[i]*b.w*k.x,shape.edge[i+1]*b.h*k.y);if(contains(point.x,point.y))return true;}return false;}
      for(let i=0;i<16;i++){const a=i*Math.PI/8;const point=worldAnchor(b,Math.cos(a)*b.w*k.x/2,Math.sin(a)*b.h*k.y/2);if(contains(point.x,point.y))return true;}return contains(b.x,b.y);
    }
  });

  function sound(type, strength = 1, miss = false, event = '', audioOptions={}) {
    if(audioOptions?.soundEvent&&audioOptions.soundEvent!=='original')event=audioOptions.soundEvent;const volume=clamp(audioOptions?.volume??1,0,2),pitch=clamp(audioOptions?.pitch??1,.25,4);
    const owner=Object.hasOwn(catalog,type)&&!catalog[weapon].behavior?type:weapon;
    const slot=event||(miss?'miss':type==='charge'||type==='strain'?'charge':type==='overload'?'release':'attack'),key=owner+':'+slot;
    if(!settings.volume||!volume||clock-(lastSounds.get(key)??-1)<.045)return;
    lastSounds.set(key,clock);
    hooks.onSound?.({weapon:owner,event:slot,strength,miss,volume,pitch,source:settings.weaponSounds[owner]?.[slot]||null});
    try {
      if (!audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        audio = new Audio(); master = audio.createGain();
        const compressor = audio.createDynamicsCompressor();
        master.connect(compressor); compressor.connect(audio.destination);
        noiseBuffer = audio.createBuffer(1, Math.floor(audio.sampleRate * .35), audio.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i=0; i<data.length; i++) data[i] = Math.random()*2-1;
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      master.gain.setValueAtTime(settings.volume * .5, audio.currentTime);
      const slots=settings.weaponSounds[owner]||{},custom=slots[slot]||(slot==='hit'?slots.attack:null);
      if(custom) {
        if(!soundBuffers.has(custom)) {
          const bytes=Uint8Array.from(atob(custom.split(',')[1]),c=>c.charCodeAt(0));
          soundBuffers.set(custom,audio.decodeAudioData(bytes.buffer).catch(()=>null));
        }
        soundBuffers.get(custom).then(buffer=>{
          const current=settings.weaponSounds[owner]||{};
          if(!buffer||!active||!settings.volume||(current[slot]||(slot==='hit'?current.attack:null))!==custom||playingSounds.size>=8)return;
          const source=audio.createBufferSource(),gain=audio.createGain();source.buffer=buffer;source.playbackRate.value=pitch;gain.gain.value=volume;source.connect(gain);gain.connect(master);playingSounds.add(source);
          source.onended=()=>{source.disconnect();gain.disconnect();playingSounds.delete(source);};source.start(0,0,Math.min(buffer.duration,10));
        });return;
      }
      const now = audio.currentTime;
      const tone = (wave, from, to, duration, gain, delay=0) => {
        const osc = audio.createOscillator(), envelope = audio.createGain();
        gain*=volume;from*=pitch;to*=pitch;osc.type=wave; osc.frequency.setValueAtTime(from,now+delay);
        osc.frequency.exponentialRampToValueAtTime(Math.max(15,to),now+delay+duration);
        envelope.gain.setValueAtTime(.001,now+delay);
        envelope.gain.linearRampToValueAtTime(gain,now+delay+.004);
        envelope.gain.exponentialRampToValueAtTime(.001,now+delay+duration);
        osc.connect(envelope); envelope.connect(master); osc.start(now+delay); osc.stop(now+delay+duration);
        osc.onended = () => { osc.disconnect(); envelope.disconnect(); };
      };
      const noise = (frequency, duration, gain, filterType='lowpass') => {
        const source=audio.createBufferSource(), filter=audio.createBiquadFilter(), envelope=audio.createGain();
        gain*=volume;frequency*=pitch;source.buffer=noiseBuffer;source.playbackRate.value=pitch; filter.type=filterType; filter.frequency.value=frequency;
        envelope.gain.setValueAtTime(gain,now); envelope.gain.exponentialRampToValueAtTime(.001,now+duration);
        source.connect(filter); filter.connect(envelope); envelope.connect(master); source.start(now); source.stop(now+duration);
        source.onended=()=>{ source.disconnect(); filter.disconnect(); envelope.disconnect(); };
      };
      if (miss) { noise(900,.09,.15,'bandpass'); return; }
      const gain = Math.min(1.2,.6+strength*.2);
      if(type==='pistol'||type==='smg') {noise(2400,.06,.9,'highpass');tone('triangle',180,38,.12,.6);tone('square',330,85,.04,.08,.07);}
      else if(type==='shotgun') {noise(1500,.2,1.1);tone('sine',95,21,.28,1);tone('triangle',420,100,.06,.16,.22);}
      else if(type==='railgun') {noise(2800,.23,.7);tone('sawtooth',1600,70,.22,.25);tone('sine',80,20,.3,.9);}
      else if(type==='charge') {tone('triangle',70,700,.3,.15);tone('sine',50,180,.3,.2);}
      else if(type==='strain') {noise(350,.15,.22,'bandpass');tone('sawtooth',110+strength*180,80,.14,.08);}
      else if(type==='overload') {tone('square',900,45,.22,.2);noise(4500,.22,.7,'highpass');tone('sine',80,20,.25,.7);}
      else if (type==='blade') { noise(4200,.09,.6,'highpass'); tone('triangle',1200,240,.07,.16); }
      else if (type==='chainsaw') { tone('sawtooth',95+Math.random()*35,75,.085,.22); noise(1800,.07,.4,'bandpass'); }
      else if (type==='shock') { tone('square',140,280,.07,.12); noise(3000,.065,.25,'highpass'); }
      else if (type==='shred') { noise(700,.24,.9); tone('triangle',130,28,.19,.6); tone('sine',85,30,.1,.3,.06); }
      else if (type==='blackhole') { tone('sine',300,24,.32,.8); noise(400,.32,.7); }
      else { tone('sine',type==='hammer'?110:165,28,.18,gain); noise(800,.09,.7); tone('triangle',75,28,.12,.25); }
    } catch { /* Audio may be disabled by the host. */ }
  }

  function addBody(name,x,y,w,h,mass=1,r=0) {
    const b={id:nextId++,name,x,y,w,h,r,mass,inv:1/mass,vx:0,vy:0,angle:0,va:0,hp:100,
      dead:false,fragment:false,detached:false,stun:0,damageFlash:0,wallAt:0,thrown:0};
    bodies.push(b);layersDirty=true; return b;
  }
  function joint(a,b,ax,ay,bx,by) { joints.push({a,b,ax,ay,bx,by,alive:true,stress:0}); }
  function reset() {
    cancelInput(); bodies=[];layersDirty=true; joints=[]; particles=[]; effects=[]; numbers=[]; stains=[]; trails=[];
    custom.clear();lastSounds.clear();
    freeze=shake=flash=0; rebuildAt=0; cooldown=0;blasts=[];gunKick=0;shots=0;projectiles=[];
    Object.assign(camera,{x:0,y:0,vx:0,vy:0,zoom:0,zv:0,kick:0,focusX:WORLD_W/2,focusY:WORLD_H/2});
    const s=settings.targetScale, x=WORLD_W/2, y=transparentSurface?WORLD_H*.45:238;
    const byId=new Map(rig.map((p,index)=>[p.id,Object.assign(addBody(p.id,x+p.x*s,y+p.y*s,p.width*s,p.height*s,p.parent===null?3:1,p.id==='head'&&p.width===p.height?p.width*s/2:0),{drawOrder:index,angle:p.rotation*Math.PI/180,restAngle:p.rotation*Math.PI/180,shapeKey:JSON.stringify([p.crop,p.flipX,p.flipY,p.mask]),visible:p.visible,opacity:p.opacity,crop:p.crop,mask:p.mask,flipX:p.flipX,flipY:p.flipY})]));
    for(const p of rig)if(p.parent) {
      const a=byId.get(p.parent),b=byId.get(p.id);
      if(p.joint){const px=x+p.joint.x*s,py=y+p.joint.y*s,pa=local(a,px,py),pb=local(b,px,py);joint(a,b,pa.x,pa.y,pb.x,pb.y);continue;}
      // Existing anchors preserve the original six-part rig's physics exactly.
      const defaults={head:[0,-36,0,31],leftArm:[-30,-25,7,-23],rightArm:[30,-25,-7,-23],leftLeg:[-17,36,0,-30],rightLeg:[17,36,0,-30]};
      if(p.parent==='torso'&&defaults[p.id]) {
        const d=defaults[p.id],ax=d[0]*a.w/56,ay=d[1]*a.h/72;
        const pa=local(a,a.x+ax,a.y+ay),pb=local(b,a.x+ax,a.y+ay);joint(a,b,pa.x,pa.y,pb.x,pb.y);
      } else {
        const dx=b.x-a.x,dy=b.y-a.y,t=1/Math.max(Math.abs(dx)/(a.w/2),Math.abs(dy)/(a.h/2),1);
        const pa=local(a,a.x+dx*t,a.y+dy*t),pb=local(b,a.x+dx*t,a.y+dy*t);joint(a,b,pa.x,pa.y,pb.x,pb.y);
      }
    }
    configureRope();hooks.onStatus?.(''); render();
  }
  function configureRope(){
    const b=bodies.find(b=>!b.dead&&!b.fragment&&b.name===settings.rope.part)||root();
    if(!b||!settings.rope.enabled){suspension=null;return;}
    const offset={x:b.w*settings.rope.x,y:b.h*settings.rope.y},p=worldAnchor(b,offset.x,offset.y),top=arenaBounds.top+22;
    suspension={body:b.id,offset,anchor:{x:clamp(p.x,arenaBounds.left,arenaBounds.right),y:top},length:settings.rope.length||Math.max(20,p.y-top)};
  }
  function ropeGeometry(){if(!targetEnabled)return null;const b=suspension&&bodies.find(b=>b.id===suspension.body&&!b.dead);return b?{body:b,anchor:suspension.anchor,end:worldAnchor(b,suspension.offset.x,suspension.offset.y),length:suspension.length}:null;}
  function constrainRope(){
    const r=ropeGeometry();if(!r)return;const dx=r.end.x-r.anchor.x,dy=r.end.y-r.anchor.y,d=Math.hypot(dx,dy);if(d<=r.length||d<.001)return;
    const nx=dx/d,ny=dy/d;r.body.x-=nx*(d-r.length);r.body.y-=ny*(d-r.length);
    const speed=r.body.vx*nx+r.body.vy*ny;if(speed>0){r.body.vx-=nx*speed;r.body.vy-=ny*speed;}
  }
  function worldAnchor(b,x,y) { const c=Math.cos(b.angle),s=Math.sin(b.angle); return {x:b.x+x*c-y*s,y:b.y+x*s+y*c}; }
  function local(b,x,y) { const c=Math.cos(b.angle),s=Math.sin(b.angle),dx=x-b.x,dy=y-b.y; return {x:dx*c+dy*s,y:-dx*s+dy*c}; }
  const emptyShape={empty:true,edge:[],width:1,height:1,alpha:new Uint8Array(1)};
  function bodyShape(b){
    if(b.visible===false||b.opacity===0)return emptyShape;
    const image=b.fragment?(settings.swearMask?b.maskedSnapshot:b.snapshot):(frameAt(textures,sequences,b.name,clock)||(b.name==='head'?target:null));
    if(!image&&!b.mask)return null;
    if(!image){
      const key=JSON.stringify([b.w,b.h,b.r,b.mask,b.crop,b.flipX,b.flipY]);if(primitiveMasks.has(key))return primitiveMasks.get(key);
      const surface=document.createElement('canvas');surface.width=clamp(Math.ceil(b.w),32,512);surface.height=clamp(Math.ceil(b.h),32,512);
      const c=surface.getContext('2d');c.translate(surface.width/2,surface.height/2);c.scale(surface.width/b.w,surface.height/b.h);clipPart(c,b,-b.w/2,-b.h/2,b.w,b.h);c.fillStyle='#fff';c.beginPath();if(b.r)c.arc(0,0,b.r,0,Math.PI*2);else c.roundRect(-b.w/2,-b.h/2,b.w,b.h,Math.min(7,b.w/3));c.fill();
      const shape=readAlphaShape(surface);if(primitiveMasks.size>=128)primitiveMasks.delete(primitiveMasks.keys().next().value);primitiveMasks.set(key,shape);return shape;
    }
    let entries=alphaShapes.get(image);if(!entries){entries=new Map();alphaShapes.set(image,entries);}
    const key=b.shapeKey??=(b.fragment?[b.sx,b.sy,b.sw,b.sh].join(','):JSON.stringify([b.crop,b.flipX,b.flipY,b.mask]));if(entries.has(key))return entries.get(key);
    const w=Math.max(1,Math.ceil(b.fragment?b.sw:image.width)),h=Math.max(1,Math.ceil(b.fragment?b.sh:image.height)),surface=document.createElement('canvas');surface.width=w;surface.height=h;
    const c=surface.getContext('2d');if(b.fragment)c.drawImage(image,b.sx,b.sy,b.sw,b.sh,0,0,w,h);else drawPartImage(c,image,b,0,0,w,h);
    const shape=readAlphaShape(surface);entries.set(key,shape);return shape;
  }
  function readAlphaShape(surface){
    const w=surface.width,h=surface.height,pixels=surface.getContext('2d').getImageData(0,0,w,h).data,alpha=new Uint8Array(w*h),edge=[];
    for(let y=0;y<h;y++){let lo=w,hi=-1;for(let x=0;x<w;x++){const a=pixels[(y*w+x)*4+3];alpha[y*w+x]=a;if(a){lo=Math.min(lo,x);hi=x;}}if(hi>=lo)edge.push(lo/w-.5,y/h-.5,(hi+1)/w-.5,y/h-.5,lo/w-.5,(y+1)/h-.5,(hi+1)/w-.5,(y+1)/h-.5);}
    return {width:w,height:h,alpha,edge:new Float32Array(edge),empty:edge.length===0};
  }
  function deformation(b){const squeeze=b.recoil>0?Math.sin(b.recoil/.16*Math.PI)*.16:0;return {x:1+squeeze,y:1-squeeze*.7};}
  function opaqueAt(b,p,shape){
    const k=deformation(b),x=Math.floor((p.x/(b.w*k.x)+.5)*shape.width),y=Math.floor((p.y/(b.h*k.y)+.5)*shape.height);
    return x>=0&&y>=0&&x<shape.width&&y<shape.height&&shape.alpha[y*shape.width+x]>0;
  }
  function bodyBounds(b){
    const shape=bodyShape(b),c=Math.cos(b.angle),s=Math.sin(b.angle),k=deformation(b);
    if(shape){if(shape.empty)return null;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(let i=0;i<shape.edge.length;i+=2){const x=shape.edge[i]*b.w*k.x,y=shape.edge[i+1]*b.h*k.y,wx=x*c-y*s,wy=x*s+y*c;left=Math.min(left,wx);right=Math.max(right,wx);top=Math.min(top,wy);bottom=Math.max(bottom,wy);}return {left,right,top,bottom};}
    const rx=b.r?Math.hypot(c*b.r*k.x,s*b.r*k.y):Math.abs(c)*b.w*k.x/2+Math.abs(s)*b.h*k.y/2,ry=b.r?Math.hypot(s*b.r*k.x,c*b.r*k.y):Math.abs(s)*b.w*k.x/2+Math.abs(c)*b.h*k.y/2;
    return {left:-rx,right:rx,top:-ry,bottom:ry};
  }
  function hitAt(x,y,padding=0) {
    const ordered=orderedBodies();
    for (let i=ordered.length-1;i>=0;i--) {
      const b=ordered[i]; if(b.dead) continue;
      const p=local(b,x,y);
      const shape=bodyShape(b);if(shape){if(!shape.empty&&opaqueAt(b,p,shape))return b;continue;}
      const inShape=b.r ? Math.hypot(p.x,p.y)<=b.r+padding : Math.abs(p.x)<=b.w/2+padding && Math.abs(p.y)<=b.h/2+padding;
      if(inShape&&(!b.circleMask||Math.hypot(p.x-b.circleMask.x,p.y-b.circleMask.y)<=b.circleMask.r+padding))return b;
    }
    return null;
  }
  // Segment against each body's local AABB / circle: no gaps between pointer samples.
  function segmentHit(b,a,z,padding=0) {
    return segmentEntry(b,a,z,padding)!==null;
  }
  function segmentEntry(b,a,z,padding=0) {
    const p=local(b,a.x,a.y), q=local(b,z.x,z.y), dx=q.x-p.x,dy=q.y-p.y;
    const shape=bodyShape(b),k=deformation(b);if(shape?.empty)return null;
    if(b.r&&!shape) {const a2=dx*dx+dy*dy,r=b.r+padding,c=p.x*p.x+p.y*p.y-r*r;if(c<=0)return 0;const b2=2*(p.x*dx+p.y*dy),d=b2*b2-4*a2*c;if(a2===0||d<0)return null;const t=(-b2-Math.sqrt(d))/(2*a2);return t>=0&&t<=1?t:null;}
    let lo=0,hi=1;
    for(const [v,d,extent] of [[p.x,dx,b.w*k.x/2+(shape?0:padding)],[p.y,dy,b.h*k.y/2+(shape?0:padding)]]) {
      if(Math.abs(d)<.0001) { if(Math.abs(v)>extent) return null; }
      else { let t1=(-extent-v)/d,t2=(extent-v)/d; if(t1>t2) [t1,t2]=[t2,t1]; lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi) return null; }
    }
    if(shape){const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx)*shape.width/(b.w*k.x),Math.abs(dy)*shape.height/(b.h*k.y))*(hi-lo)*2));for(let i=0;i<=steps;i++){const t=lo+(hi-lo)*i/steps;if(opaqueAt(b,{x:p.x+dx*t,y:p.y+dy*t},shape))return t;}return null;}
    return lo;
  }
  function burst(x,y,count,color=settings.liquidColor,kind='liquid',dx=0,dy=0) {
    const n=Math.floor(count*(kind==='liquid'?1:settings.particles));
    for(let i=0;i<n && particles.length<settings.particleLimit;i++) {
      const angle=Math.random()*Math.PI*2,speed=40+Math.random()*230;
      particles.push({x,y,vx:Math.cos(angle)*speed+dx*.25,vy:Math.sin(angle)*speed+dy*.25-40,
        life:.3+Math.random()*.65,max:1,size:kind==='spark'?1+Math.random()*2:(1.5+Math.random()*3)*(kind==='liquid'?settings.particleSize:1),color,kind});
    }
  }
  function effect(kind,x,y,color,size=50,angle=0,duration=.24,data={}) {
    if(effects.length>=120) effects.shift();
    effects.push({kind,x,y,color,size,angle,life:duration,max:duration,seed:Math.random()*99,...data});
  }
  function detach(j,x,y) {
    if(!j.alive) return;
    j.alive=false;j.b.detached=true;
    burst(x,y,settings.liquid*.7); burst(x,y,12,catalog[weapon].color,'spark');
    effect('cut',x,y,settings.liquidColor,36,Math.random()*6);
  }
  function shatter(b,dx=0,dy=-250) {
    if(b.dead||b.fragment) return;
    // Snapshot and tile the actual body. The intact render/collider is removed.
    const physicalWidth=Math.ceil(b.w+4),physicalHeight=Math.ceil(b.h+4),resolution=Math.min(1,1024/Math.max(physicalWidth,physicalHeight));
    const snapshot=document.createElement('canvas'); snapshot.width=Math.max(1,Math.ceil(physicalWidth*resolution));snapshot.height=Math.max(1,Math.ceil(physicalHeight*resolution));
    const c=snapshot.getContext('2d'); c.translate(snapshot.width/2,snapshot.height/2);c.scale(snapshot.width/physicalWidth,snapshot.height/physicalHeight);drawBody(c,{...b,x:0,y:0,angle:0,damageFlash:0,stun:0},false);
    const maskedSnapshot=document.createElement('canvas');maskedSnapshot.width=snapshot.width;maskedSnapshot.height=snapshot.height;
    const mc=maskedSnapshot.getContext('2d');mc.translate(snapshot.width/2,snapshot.height/2);mc.scale(snapshot.width/physicalWidth,snapshot.height/physicalHeight);const wasMasked=settings.swearMask;settings.swearMask=true;drawBody(mc,{...b,x:0,y:0,angle:0,damageFlash:0,stun:0},false);settings.swearMask=wasMasked;
    // Capture the unmasked version regardless of the current switch.
    if(wasMasked){c.clearRect(-physicalWidth/2,-physicalHeight/2,physicalWidth,physicalHeight);settings.swearMask=false;drawBody(c,{...b,x:0,y:0,angle:0,damageFlash:0,stun:0},false);settings.swearMask=true;}
    b.dead=true;
    for(const j of joints) if(j.alive && (j.a===b||j.b===b)) detach(j,b.x,b.y);
    const cols=b.w>30?3:2,rows=3;
    for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
      const w=physicalWidth/cols,h=physicalHeight/rows,sw=snapshot.width/cols,sh=snapshot.height/rows;
      const pos=worldAnchor(b,-physicalWidth/2+(col+.5)*w,-physicalHeight/2+(row+.5)*h);
      const shard=addBody('fragment',pos.x,pos.y,w,h,.22);
      Object.assign(shard,{drawOrder:b.drawOrder,fragment:true,detached:true,angle:b.angle,va:(Math.random()-.5)*12,
        vx:b.vx+dx+(col-(cols-1)/2)*140+(Math.random()-.5)*90,
        vy:b.vy+dy+(row-1)*120,snapshot,maskedSnapshot,sx:col*sw,sy:row*sh,sw,sh,ttl:30,
        circleMask:b.r?{x:physicalWidth/2-(col+.5)*w,y:physicalHeight/2-(row+.5)*h,r:b.r}:null});
    }
    burst(b.x,b.y,settings.liquid*1.2); effect('ring',b.x,b.y,settings.liquidColor,75);
  }
  function recordDamage(b,amount,x,y,label='',source=weapon) {
    if(bodyShape(b)?.empty)return;
    const dmg=clamp(Math.round(amount*settings.power),1,100000);
    combo=comboLeft>0?combo+1:1;comboLeft=2.1;b.damageFlash=.12;
    if(settings.numbers) {
      const previous=numbers.find(n=>n.source===source&&n.label===label&&clock-n.updated<.16&&((source==='shock'&&!label)||n.bodyId===b.id));
      if(previous){previous.amount+=dmg;previous.text='+'+previous.amount;previous.life=.75;previous.updated=clock;previous.y=y-20;}
      else {
        if(numbers.length>48)numbers.shift();
        numbers.push({x:x+(Math.random()-.5)*12,y:y-20,text:'+'+dmg,amount:dmg,life:.75,label,source,bodyId:b.id,updated:clock});
      }
    }
    const line=dialogue.hit(clock);if(line)hooks.onSpeech?.(line);
    hooks.onHit?.({damage:dmg,combo,weapon:source});
    hooks.onCombo?.(combo,1);
    return dmg;
  }
  function impact(b,x,y,strength=1,dx=1,dy=-.35,options={}) {
    if(!b||b.dead||bodyShape(b)?.empty) return;
    const source=options.weapon||weapon,w=spec(source),len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
    const force=w.force*strength*settings.knockback*1.4;
    b.vx+=ux*force/Math.sqrt(b.mass);b.vy+=uy*force/Math.sqrt(b.mass);
    if(strength>=.9)for(const other of connected(b))if(other!==b){other.vx+=ux*force*.25/Math.sqrt(other.mass);other.vy+=uy*force*.25/Math.sqrt(other.mass);other.thrown=.35;}
    b.recoil=.16;b.hitAngle=Math.atan2(uy,ux);
    b.va+=clamp((x-b.x)*dy-(y-b.y)*dx,-30,30)*.025*strength;
    const amount=recordDamage(b,w.damage*strength,x,y,options.label||'',source);
    b.hp-=amount/settings.power/settings.toughness;
    if(settings.liquid>0&&!b.fragment){const pos=local(b,x,y);(b.paint??=[]).push({kind:'splat',x:pos.x,y:pos.y,angle:Math.random()*6.28,r:Math.min(19,4+Math.sqrt(settings.liquid)*1.2),color:settings.liquidColor});b.paint=b.paint.slice(-32);}
    burst(x,y,settings.liquid*Math.min(2,strength),settings.liquidColor,'liquid',ux*force,uy*force);
    burst(x,y,16*strength,w.color,'spark',ux*force,uy*force);
    effect((w.behavior||source)==='blade'?'cut':(w.behavior||source)==='hammer'?'crack':'ring',x,y,w.color,30+strength*25,Math.atan2(uy,ux));
    effect('impact',x,y,'#fff0d4',28+strength*15,Math.atan2(uy,ux),.18);
    camera.vx=clamp(camera.vx-ux*140*strength*settings.shake,-500,500);camera.vy=clamp(camera.vy-uy*140*strength*settings.shake,-500,500);
    cameraPunch(strength,x,y);
    shake=Math.max(shake,Math.min(22,strength*9)*settings.shake);
    if(settings.flash) flash=Math.max(flash,Math.min(.22,strength*.065));
    if(!options.rapid)freeze=Math.max(freeze,Math.min(.11,strength*.042)*settings.hitstop);
    if(!options.silent)sound(source,strength,false,'hit');
    else if(settings.weaponSounds[source]?.hit)sound(source,strength,false,'hit');
    if(options.cut) for(const j of joints) if(j.alive&&j.b===b) detach(j,x,y);
    if(options.breakable&&b.hp<=0) shatter(b,ux*180,uy*180);
    if(b.fragment) {b.ttl=30;b.thrown=2;}
    return amount;
  }
  function selectWeapon(id) {
    if(!Object.hasOwn(catalog,id)) return;
    cancelInput();weapon=id;behavior=catalog[id].behavior||id;loadWeaponImages();custom.configure(catalog[id]);cooldown=0;hooks.onWeapon?.(id,catalog[id]);
  }
  function point(e) {
    if(e.world)return {x:clamp((e.x-WORLD_W/2-view.x)/view.zoom+WORLD_W/2,0,WORLD_W),y:clamp((e.y-WORLD_H/2-view.y)/view.zoom+WORLD_H/2,0,WORLD_H)};
    const rect=canvas.getBoundingClientRect();
    return {x:clamp(((e.clientX-rect.left-offsetX)/scale-view.x-WORLD_W/2)/view.zoom+WORLD_W/2,0,WORLD_W),
      y:clamp(((e.clientY-rect.top-offsetY)/scale-view.y-WORLD_H/2)/view.zoom+WORLD_H/2,0,WORLD_H)};
  }
  const gunOrigin=()=>weaponOrigin??{x:55,y:FLOOR-55};
  function spriteGeometry(){
    const appearance=catalog[weapon]?.appearance;if(!appearance?.frames.length)return null;const origin=gunOrigin(),angle=(appearance.aim?Math.atan2(pointer.y-origin.y,pointer.x-origin.x):0)+appearance.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),x=(appearance.muzzleX-appearance.pivotX)*appearance.width,y=(appearance.muzzleY-appearance.pivotY)*appearance.height;
    return {...origin,angle,appearance,muzzle:{x:origin.x+x*c-y*s,y:origin.y+x*s+y*c}};
  }
  function loadWeaponImages(){
    const frames=catalog[weapon]?.appearance?.frames??[];if(frames.length===weaponSources.length&&frames.every((src,i)=>src===weaponSources[i]))return;
    weaponSources=[...frames];weaponImages=[];const revision=++weaponImageRevision;
    Promise.all(frames.map(src=>platform.loadImage?platform.loadImage(src).catch(()=>null):new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=src;}))).then(images=>{if(revision!==weaponImageRevision)return;weaponImages=images;render();});
  }
  function gunGeometry() {
    const {x,y}=gunOrigin(),angle=Math.atan2(pointer.y-y,pointer.x-x);
    return {x,y,angle,muzzle:{x:x+42*Math.cos(angle),y:y+42*Math.sin(angle)}};
  }
  function rayContacts(start,end) {
    const contacts=[];
    for(const b of alive()){const t=segmentEntry(b,start,end);if(t!==null)contacts.push({b,t,x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t});}
    return contacts.sort((a,b)=>a.t-b.t);
  }
  function cameraPunch(strength,x=350,y=260) {
    camera.focusX=x;camera.focusY=y;
    camera.kick=Math.max(camera.kick,Math.min(.23,.045+strength*.035)*settings.zoom);
    // Jump across the charge pullback, then let the spring overshoot and settle.
    camera.zoom=Math.max(camera.zoom,camera.kick*.65);camera.zv=Math.max(camera.zv,.5*settings.zoom);
  }
  function wallImpact(end,charge) {
    const rail=behavior==='railgun',heavy=rail?2+charge*3:behavior==='shotgun'?1.3:behavior==='smg'?.8:1;
    const normal=end.x<=arenaBounds.left+1?0:end.x>=arenaBounds.right-1?Math.PI:end.y<=arenaBounds.top+1?Math.PI/2:-Math.PI/2;
    const ux=Math.cos(normal),uy=Math.sin(normal),color=rail?'#a6f5ff':'#ffae52';
    effect('wallFire',end.x,end.y,color,(rail?85:75)*heavy,normal,rail?.85:.48,{rail,charge});
    effect('scorch',end.x,end.y,'#080807',rail?28+charge*32:12,normal,5);
    effect('ricochet',end.x,end.y,'#fff1c5',32*heavy,normal,.32);
    burst(end.x+ux*3,end.y+uy*3,rail?70+charge*100:24,color,'spark',ux*450*heavy,uy*450*heavy);
    burst(end.x+ux*3,end.y+uy*3,rail?26:8,'#857b68','debris',ux*220*heavy,uy*220*heavy);
    shake=Math.max(shake,Math.min(30,heavy*7)*settings.shake);
    camera.vx+=ux*heavy*70*settings.shake;camera.vy+=uy*heavy*70*settings.shake;
    cameraPunch(rail?4+charge*3:.6,end.x,end.y);
    if(rail) {
      effect('wallShock',end.x,end.y,color,110+charge*150,normal,.7);
      freeze=Math.max(freeze,(.08+charge*.07)*settings.hitstop);
      const radius=100+charge*100;
      for(const b of alive().slice()) {
        const d=Math.hypot(b.x-end.x,b.y-end.y);
        if(d<radius)impact(b,b.x,b.y,(1-d/radius)*(1+charge),b.x-end.x,b.y-end.y,{weapon,silent:true,breakable:true,get label(){return i18nText("combat.007");}});
      }
    }
  }
  function fireGun(charge=0) {
    const w=spec(),g=gunGeometry(),pellets=behavior==='shotgun'?(w.pellets||7):1;
    shots++;sound(weapon,behavior==='shotgun'?2:1+charge);
    gunKick=Math.min(22,gunKick+(behavior==='shotgun'?18:behavior==='railgun'?22:7)*settings.recoil);
    camera.vx-=Math.cos(g.angle)*22*settings.shake*settings.recoil;
    camera.vy-=Math.sin(g.angle)*22*settings.shake*settings.recoil;
    effect('muzzle',g.muzzle.x,g.muzzle.y,w.color,behavior==='shotgun'?48:behavior==='railgun'?55:30,g.angle,.14);
    if(behavior!=='railgun'&&particles.length<settings.particleLimit)particles.push({x:g.x,y:g.y,vx:-70-Math.random()*50,vy:-130-Math.random()*40,life:1.1,size:3,color:'#c9a976',kind:'casing'});
    for(let i=0;i<pellets;i++) {
      const spread=behavior==='shotgun'?(i-(pellets-1)/2)*.026:(behavior==='smg'||catalog[weapon].behavior==='pistol')?(Math.random()-.5)*.022:0;
      const angle=g.angle+spread*settings.gunSpread*(w.spread??1),ux=Math.cos(angle),uy=Math.sin(angle);
      let length=Infinity;
      for(const [distance,direction,origin] of [[arenaBounds.right,ux,g.muzzle.x],[arenaBounds.left,ux,g.muzzle.x],[FLOOR,uy,g.muzzle.y],[arenaBounds.top,uy,g.muzzle.y]]) {
        if(Math.abs(direction)<1e-9)continue;const t=(distance-origin)/direction;if(t>=0)length=Math.min(length,t);
      }
      const end={x:g.muzzle.x+ux*length,y:g.muzzle.y+uy*length};
      const contacts=rayContacts(g.muzzle,end),pierce=behavior==='railgun'&&charge>.4;
      const selected=pierce?contacts.slice(0,8):contacts.slice(0,1);
      const terminal=selected.length&&!pierce?selected[0]:end;
      effect(behavior==='railgun'?'rail':'tracer',g.muzzle.x,g.muzzle.y,w.color,Math.hypot(terminal.x-g.muzzle.x,terminal.y-g.muzzle.y),angle,behavior==='railgun'?.55:.1,{charge});
      for(const hit of selected) {
        const headshot=hit.b.name==='head';
        impact(hit.b,hit.x,hit.y,(1+charge*4)*(headshot?1.4:1),ux,uy,{silent:true,rapid:behavior==='smg'||behavior==='shotgun',breakable:true,cut:behavior==='railgun'&&charge>.8,label:headshot?'HEADSHOT':'',weapon});
      }
      if(!selected.length||pierce)wallImpact(end,charge);
    }
    cooldown=w.interval;
    if(behavior==='shotgun'||behavior==='railgun')freeze=Math.max(freeze,.075*settings.hitstop);
  }
  function fireSwear() {
    const words=settings.swearWords||[];if(!words.length){hooks.onStatus?.(i18nText("combat.008"));effect('graffiti',pointer.x,pointer.y,color('swear'),22,0,.6,{get text(){return i18nText("combat.009");}});return;}
    const total=words.reduce((n,w)=>n+w.count,0);const pick=()=>{let n=Math.random()*total;for(const w of words){n-=w.count;if(n<=0)return w.word;}return words.at(-1).word;};
    const count=3+Math.floor(Math.random()*6);shots++;sound('swear',1);const g=gunGeometry();
    for(let i=0;i<count;i++){
      const angle=g.angle+(Math.random()-.5)*.16*settings.gunSpread,speed=(spec().speed||900)*(.85+Math.random()*.3);
      if(projectiles.length<96)projectiles.push({x:g.muzzle.x,y:g.muzzle.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,weapon, text:pick(),color:catalog[weapon].behavior?spec().color:['#ff5d7a','#ffc857','#66dec9'][Math.floor(Math.random()*3)],size:14+Math.random()*9,life:Math.hypot(WORLD_W,WORLD_H)/speed+1});
    }
    effect('muzzle',g.muzzle.x,g.muzzle.y,color('swear'),40,g.angle,.2);
    cooldown=spec().interval;
  }
  function updateProjectiles(dt) {
    for(const p of projectiles) {
      p.life-=dt;const end={x:clamp(p.x+p.vx*dt,arenaBounds.left,arenaBounds.right),y:clamp(p.y+p.vy*dt,arenaBounds.top,FLOOR)};
      const hit=rayContacts(p,end)[0],wall=end.x===arenaBounds.left||end.x===arenaBounds.right||end.y===arenaBounds.top||end.y===FLOOR;
      if(hit||wall) {
        const x=hit?.x??end.x,y=hit?.y??end.y;p.life=0;
        effect('graffiti',x,y,p.color,p.size*1.7,(Math.random()-.5)*.6,.6,{text:p.text});
        burst(x,y,14,p.color,'spark',-p.vx*.1,-p.vy*.1);
        const decal={x,y,r:p.size,color:p.color,life:30,text:p.text,angle:(Math.random()-.5)*.5};
        if(hit) {
          impact(hit.b,x,y,.35,p.vx,p.vy,{weapon:p.weapon,silent:true,rapid:true,label:p.text});
          const pos=local(hit.b,x,y);(hit.b.paint??=[]).push({...decal,x:pos.x,y:pos.y});hit.b.paint=hit.b.paint.slice(-12);
        } else {if(stains.length>=240)stains.shift();stains.push(decal);cameraPunch(.15,x,y);}
      }
      p.x=end.x;p.y=end.y;
    }
    projectiles=projectiles.filter(p=>p.life>0);
  }
  function down(e) {
    if(ropePicking&&e.button===0&&active){e.preventDefault();const p=point(e),b=hitAt(p.x,p.y);if(b&&!b.fragment){const offset=local(b,p.x,p.y);ropePicking=false;hooks.onRopeAttachment?.({part:b.name,x:clamp(offset.x/b.w,-.5,.5),y:clamp(offset.y/b.h,-.5,.5)});}return;}
    if(e.button===2){teleportWeapon(e);return;}
    if(!active||!targetEnabled||e.button!==0||input||cooldown>0) return;
    e.preventDefault();pointer=point(e);
    const b=hitAt(pointer.x,pointer.y);
    input={id:e.pointerId,start:{...pointer},prev:{...pointer},time:0,tick:0,b,history:[{...pointer,t:clock}],hits:new Map(),tear:0};
    canvas.setPointerCapture?.(e.pointerId);
    if(behavior==='graph'){custom.down(pointer);return;}
    if(['fist','hammer','grab','shred'].includes(behavior)&&settings.weaponSounds[weapon]?.attack)sound(weapon,1,false,'attack');
    if(behavior==='swear'){fireSwear();input.tick=spec().interval;}
    else if(wGun()) {if(behavior==='railgun')sound('charge');else {fireGun();input.tick=spec().interval;}}
    else if(behavior==='blackhole') { input.field=true;sound('charge',.2); }
    else if(behavior==='grab'||behavior==='shred') {
      if(b) {input.offset=local(b,pointer.x,pointer.y);sound('fist',.2);} else sound(weapon,1,true);
    } else if(behavior==='blade') slash(input.prev,pointer);
    else if(behavior==='chainsaw'||behavior==='shock') {continuous();input.tick=spec().interval;}
    hooks.onCharge?.(0);
  }
  function teleportWeapon(e){if(!active)return;e.preventDefault?.();cancelInput();weaponOrigin=point(e);pointer={...weaponOrigin};gunKick=0;render();}
  function wGun(){return !!catalog[weapon].gun;}
  function move(e) {
    if(!active) return;
    pointer=point(e);
    if(!input||e.pointerId!==input.id) return;
    if(behavior==='graph')custom.move(pointer);
    if(behavior==='blade') slash(input.prev,pointer);
    input.prev={...pointer};
    input.history.push({...pointer,t:clock});input.history=input.history.slice(-7);
  }
  function release(e) {
    if(!input||e.pointerId!==input.id) return;
    pointer=point(e);const press=input;
    if(behavior==='graph'){custom.up(pointer);cancelInput();return;}
    if(settings.weaponSounds[weapon]?.release)sound(weapon,1,false,'release');
    if(behavior==='railgun')fireGun(clamp(press.time/(spec().chargeTime||1.1),0,1));
    if((behavior==='fist'||behavior==='hammer')&&cooldown<=0) {
      const charge=clamp(press.time/(spec().chargeTime||1.1),0,1),b=hitAt(pointer.x,pointer.y);
      if(b) {
        const finisher=behavior==='fist'&&comboLeft>0&&(combo+1)%5===0;
        const strength=1+charge*2+(finisher?1.5:0);
        const direction=(pointer.x-WORLD_W/2)*.02||((combo%2)?-1:1);
        impact(b,pointer.x,pointer.y,strength,behavior==='hammer'?0:direction,behavior==='hammer'?1:-.45,{breakable:behavior==='hammer',label:finisher?'FINISH':charge>.6?'CHARGE':''});
        if(behavior==='hammer') {
          effect('hammer',pointer.x,pointer.y,color('hammer'),50+charge*40,0,.4);
          effect('ring',pointer.x,pointer.y,color('hammer'),100+charge*80,0,.45);
          for(const other of alive()) if(other!==b && Math.hypot(other.x-pointer.x,other.y-pointer.y)<100+charge*70) {
            impact(other,other.x,other.y,strength*.4,other.x-pointer.x,-80,{breakable:true});
          }
        } else effect('fist',pointer.x,pointer.y,color('fist'),22+charge*14,Math.atan2(-.45,direction),.2);
        cooldown=spec().interval;
      } else {sound(weapon,1,true);effect('miss',pointer.x,pointer.y,'#777',18,0,.12);}
    }
    if((behavior==='grab'||behavior==='shred')&&press.b&&!press.b.dead) {
      const samples=press.history.filter(p=>clock-p.t<.12),first=samples[0];
      const dt=first?Math.max(.025,clock-first.t):1;
      const vx=clamp(first?(pointer.x-first.x)/dt:0,-1400,1400),vy=clamp(first?(pointer.y-first.y)/dt:0,-1400,1400);
      for(const body of connected(press.b)) {body.vx=vx;body.vy=vy;if(Math.hypot(vx,vy)>180)body.thrown=2;}
    }
    if(behavior==='blackhole') explodeField();
    if(behavior==='shock') dischargeShock();
    cancelInput();
  }
  function cancelInput() {
    if(input) {try{canvas.releasePointerCapture?.(input.id);}catch{}}
    custom.cancel();input=null;hooks.onCharge?.(0);
  }
  function slash(a,z) {
    if(!input) return;
    const distance=Math.hypot(z.x-a.x,z.y-a.y),w=spec();
    if(settings.trails) {trails.push({a:{...a},b:{...z},life:.16,color:w.color});if(trails.length>64) trails.shift();}
    let touched=false;
    for(const b of alive()) if(segmentHit(b,a,z,2) && clock-(input.hits.get(b.id)??-10)>=w.interval) {
      input.hits.set(b.id,clock);touched=true;
      const strength=clamp(.7+distance/90,.7,2);
      impact(b,b.x,b.y,strength,z.x-a.x||1,z.y-a.y||-.2,{cut:true,breakable:true});
    }
    if(!touched&&distance>25) sound(weapon,1,true);
  }
  function connected(b) {
    const found=new Set([b]);let changed=true;
    while(changed) {changed=false;for(const j of joints) if(j.alive && (found.has(j.a)||found.has(j.b))) {
      if(!found.has(j.a)||!found.has(j.b)) changed=true;found.add(j.a);found.add(j.b);
    }} return [...found].filter(p=>!p.dead);
  }
  function continuous() {
    if(!input) return;
    const latched=input.latch;
    const b=hitAt(pointer.x,pointer.y,behavior==='shock'?9:5)||(behavior==='shock'&&latched&&!latched.dead&&Math.hypot(latched.x-pointer.x,latched.y-pointer.y)<110?latched:null);
    if(!b) return;
    if(behavior==='chainsaw') {
      impact(b,pointer.x,pointer.y,.65,(Math.random()-.5),-.2,{breakable:true});
      const j=joints.find(j=>j.alive&&j.b===b);if(j) {j.stress+=.28/settings.toughness;if(j.stress>=1) detach(j,pointer.x,pointer.y);}
      effect('saw',pointer.x,pointer.y,color('chainsaw'),23,clock*30,.12);
    } else {
      input.latch=b;input.energy=Math.min(1,(input.energy||0)+.14);
      const connectedParts=connected(b);
      const nearby=alive().filter(p=>!connectedParts.includes(p)&&Math.hypot(p.x-b.x,p.y-b.y)<75+input.energy*40).slice(0,3);
      const targets=[...connectedParts,...nearby];
      let previous={...pointer};
      for(const p of targets) {
        p.stun=.32;p.vx+=(Math.random()-.5)*65;p.va+=(Math.random()-.5)*3;
        recordDamage(p,spec().damage/(p===b?1:3),p.x,p.y);
        p.hp-=spec().damage/(p===b?1:3)/settings.toughness;
        lightning(previous,p,1+input.energy);previous=p;
        effect('teslaNode',p.x,p.y,color('shock'),16+input.energy*12,clock,.22);
        burst(p.x,p.y,5,color('shock'),'spark');
      }
      hooks.onCharge?.(input.energy);
      sound('shock');shake=Math.max(shake,settings.shake*4);
      if(input.energy>=1)dischargeShock();
    }
  }
  function lightning(a,b,strength=1) {
    if(!settings.energyFx)return;
    effect('lightning',a.x,a.y,color('shock'),Math.hypot(b.x-a.x,b.y-a.y),Math.atan2(b.y-a.y,b.x-a.x),.19,{strength});
  }
  function dischargeShock() {
    if(!input||!(input.energy>=.5)||!input.latch||input.latch.dead)return;
    const charge=input.energy,center={x:input.latch.x,y:input.latch.y};
    const targets=connected(input.latch);
    for(const b of targets) {
      lightning(center,b,3);impact(b,b.x,b.y,1.5+charge,b.x-center.x||Math.random()-.5,b.y-center.y-35,{weapon,breakable:true,silent:true,rapid:true,get label(){return i18nText("combat.010");}});
    }
    effect('teslaBurst',center.x,center.y,color('shock'),125+charge*80,0,.6);
    effect('impact',center.x,center.y,'#f5efff',90,0,.22);
    sound('overload');freeze=Math.max(freeze,.075*settings.hitstop);input.energy=0;hooks.onCharge?.(0);
  }
  function explodeField() {
    if(!input?.field) return;
    const radius=(spec().radius||100)+Math.min(input.time,1.6)*80,charge=clamp(input.time/1.6,.1,1);
    blasts.push({weapon,x:pointer.x,y:pointer.y,radius,charge,age:0});
    effect('collapse',pointer.x,pointer.y,color('blackhole'),radius,0,.15);
    cooldown=spec().interval;
  }
  function updateBlasts(dt) {
    for(const blast of blasts) {
      blast.age+=dt;
      if(blast.age<.14) {
        for(const b of alive())if(Math.hypot(b.x-blast.x,b.y-blast.y)<blast.radius){b.vx+=(blast.x-b.x)*dt*45;b.vy+=(blast.y-b.y)*dt*45;b.vortex=.2;}
      }else if(!blast.done) {
        blast.done=true;let hits=0;
        for(const b of alive()) {
          const dx=b.x-blast.x,dy=b.y-blast.y,dist=Math.hypot(dx,dy);
          if(dist<=blast.radius){impact(b,b.x,b.y,1.2+blast.charge,dist<4?Math.random()-.5:dx,dist<4?-1:dy,{weapon:blast.weapon,breakable:true,silent:true});hits++;}
        }
        effect('nova',blast.x,blast.y,color('blackhole'),blast.radius*1.5,0,.72);
        effect('impact',blast.x,blast.y,'#f1e4ff',100,0,.22);
        if(hits){sound('blackhole',2);cameraPunch(4,blast.x,blast.y);}else sound('blackhole',1,true);
      }
    }
    blasts=blasts.filter(b=>!b.done);
  }
  function updateInput(dt) {
    if(!input) return;
    input.time+=dt;input.tick-=dt;
    if(!input.chargeSound&&input.time>.15&&['fist','hammer'].includes(behavior)) {input.chargeSound=true;if(settings.weaponSounds[weapon]?.charge)sound('charge',.5);}
    if(behavior==='fist'||behavior==='hammer'||behavior==='railgun') hooks.onCharge?.(clamp(input.time/(spec().chargeTime||1.1),0,1));
    if((behavior==='smg'||behavior==='swear')&&input.tick<=0){behavior==='smg'?fireGun():fireSwear();input.tick=spec().interval;}
    if((behavior==='chainsaw'||behavior==='shock')&&input.tick<=0) {continuous();input.tick=spec().interval;}
    if(behavior==='blackhole'&&input.field) {
      const radius=(spec().radius||100)+Math.min(input.time,1.6)*80;
      hooks.onCharge?.(clamp(input.time/1.6,0,1));
      for(const b of alive()) {const dx=pointer.x-b.x,dy=pointer.y-b.y,dist=Math.hypot(dx,dy);
        if(dist<radius) {const swirl=5+Math.min(input.time,1.6)*6;b.vx+=(dx*14-dy*swirl)*dt;b.vy+=(dy*14+dx*swirl)*dt;b.vx*=Math.exp(-dt*3);b.vy*=Math.exp(-dt*3);b.va+=dt*4;b.vortex=.15;}
      }
      if(input.time>2.2) {explodeField();cancelInput();}
    }
    if((behavior==='grab'||behavior==='shred')&&input.b&&!input.b.dead) {
      const b=input.b,anchor=worldAnchor(b,input.offset.x,input.offset.y),dx=pointer.x-anchor.x,dy=pointer.y-anchor.y;
      b.vx+=clamp(dx*100-b.vx*14,-18000,18000)*dt;b.vy+=clamp(dy*100-b.vy*14,-18000,18000)*dt;
      if(Math.hypot(b.vx,b.vy)>220)for(const part of connected(b))part.thrown=.4;
      const j=joints.find(j=>j.alive&&j.b===b);
      if(behavior==='shred') {
        const origin=j?worldAnchor(j.a,j.ax,j.ay):input.start;
        const distance=Math.hypot(pointer.x-origin.x,pointer.y-origin.y);
        const threshold=(j?110:90)*settings.toughness;
        input.tear=clamp((distance-25)/threshold,0,1);hooks.onCharge?.(input.tear);
        if(input.tear>.2&&input.tick<=0){sound('strain',input.tear);input.tick=.18;}
        if(input.tear>=1 && input.time>.12) {
          effect('rip',b.x,b.y,color('shred'),90,Math.atan2(pointer.y-origin.y,pointer.x-origin.x),.55);
          if(j) {detach(j,b.x,b.y);impact(b,b.x,b.y,1.4,dx,dy,{get label(){return i18nText("combat.011");}});input.start={...pointer};input.time=0;}
          else {effect('shredBloom',b.x,b.y,color('shred'),120,0,.5);impact(b,b.x,b.y,1.8,dx,dy,{get label(){return i18nText("combat.012");}});shatter(b,clamp(dx*2,-700,700),clamp(dy*2,-700,700));cancelInput();}
          sound('shred');
        }
      }
    }
  }

  function physics(dt) {
    updateBlasts(dt);
    updateProjectiles(dt);
    for(const b of alive()) {
      b.damageFlash=Math.max(0,b.damageFlash-dt);b.stun=Math.max(0,b.stun-dt);b.thrown=Math.max(0,b.thrown-dt);
      b.recoil=Math.max(0,(b.recoil||0)-dt);b.vortex=Math.max(0,(b.vortex||0)-dt);
      const tethered=!b.detached&&!b.fragment;
      b.vy+=360*settings.gravity*dt;
      const damping=Math.exp(-dt*(tethered&&b.thrown<=0?2.4:.45));b.vx*=damping;b.vy*=damping;
      if(tethered) b.va+=(Math.atan2(Math.sin((b.restAngle??0)-b.angle),Math.cos((b.restAngle??0)-b.angle))*8-b.va*3)*dt;
      b.vx=clamp(b.vx,-1600,1600);b.vy=clamp(b.vy,-1600,1600);
      b.x+=b.vx*dt;b.y+=b.vy*dt;b.angle+=b.va*dt;b.va*=Math.exp(-dt*1.5);
    }
    // Position constraints with mass weighting and velocity correction.
    for(let iteration=0;iteration<6;iteration++) for(const j of joints) if(j.alive&&!j.a.dead&&!j.b.dead) {
      const a=worldAnchor(j.a,j.ax,j.ay),b=worldAnchor(j.b,j.bx,j.by),dx=b.x-a.x,dy=b.y-a.y;
      const sum=j.a.inv+j.b.inv,fa=j.a.inv/sum*.55,fb=j.b.inv/sum*.55;
      j.a.x+=dx*fa;j.a.y+=dy*fa;j.b.x-=dx*fb;j.b.y-=dy*fb;
      // Only a small velocity correction is needed; the constraints carry the rest.
      if(iteration===0) {
        j.a.vx+=dx*fa*4;j.a.vy+=dy*fa*4;j.b.vx-=dx*fb*4;j.b.vy-=dy*fb*4;
        const ia=(j.a.w*j.a.w+j.a.h*j.a.h)/12,ib=(j.b.w*j.b.w+j.b.h*j.b.h)/12;
        j.a.va+=clamp(((a.x-j.a.x)*dy-(a.y-j.a.y)*dx)/ia*2,-.15,.15);
        j.b.va-=clamp(((b.x-j.b.x)*dy-(b.y-j.b.y)*dx)/ib*2,-.15,.15);
      }
    }
    constrainRope();
    for(const b of alive()) {
      const bounds=bodyBounds(b);if(!bounds){if(b.fragment){b.ttl-=dt;if(b.ttl<=0)b.dead=true;}continue;}
      let speed=0,x=b.x,y=b.y;
      if(b.x+bounds.left<arenaBounds.left) {speed=Math.max(speed,-b.vx);b.x=arenaBounds.left-bounds.left;b.vx=Math.abs(b.vx)*settings.bounce;x=arenaBounds.left;}
      if(b.x+bounds.right>arenaBounds.right) {speed=Math.max(speed,b.vx);b.x=arenaBounds.right-bounds.right;b.vx=-Math.abs(b.vx)*settings.bounce;x=arenaBounds.right;}
      if(b.y+bounds.top<arenaBounds.top) {speed=Math.max(speed,-b.vy);b.y=arenaBounds.top-bounds.top;b.vy=Math.abs(b.vy)*settings.bounce;y=arenaBounds.top;}
      if(b.y+bounds.bottom>FLOOR) {speed=Math.max(speed,b.vy);b.y=FLOOR-bounds.bottom;b.vy=-Math.abs(b.vy)*settings.bounce;b.vx*=.94;b.va*=.92;y=FLOOR;}
      if(speed>260&&b.thrown>0&&clock>b.wallAt) {
        b.wallAt=clock+.22;recordDamage(b,spec().damage*clamp(speed/500,.4,2),x,y,'SLAM');
        burst(x,y,settings.liquid*.6);effect('crack',x,y,color('grab'),45);
        sound('hammer',speed/600);shake=Math.max(shake,7*settings.shake);freeze=Math.max(freeze,.03*settings.hitstop);
      }
      if(b.fragment) {b.ttl-=dt;if(b.ttl<=0)b.dead=true;}
    }
    const remaining=bodies.filter(b=>!b.dead);if(remaining.length!==bodies.length)layersDirty=true;bodies=remaining;
    // Dead joints must not retain references to snapshots / removed bodies.
    joints=joints.filter(j=>j.alive&&!j.a.dead&&!j.b.dead);
    if(settings.autoRebuild&&!alive().some(b=>!b.fragment)) {
      if(!rebuildAt) rebuildAt=clock+1.8;
      if(clock>=rebuildAt) reset();
    }
  }
  function visuals(dt) {
    for(const p of particles) {
      p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=420*dt;p.vx*=Math.exp(-dt*1.2);
      if(p.y>FLOOR&&p.kind==='casing'){p.y=FLOOR;p.vy=-Math.abs(p.vy)*.35;p.vx*=.75;}
      if(p.y>FLOOR&&p.kind==='liquid') {
        if(stains.length>=180) stains.shift();stains.push({x:clamp(p.x,arenaBounds.left,arenaBounds.right),y:FLOOR+Math.random()*4,r:p.size*1.5,color:p.color,life:8});p.life=0;
      }
    }
    particles=particles.filter(p=>p.life>0);
    for(const list of [effects,numbers,stains,trails]) for(const p of list) {p.life-=dt;if(list===numbers)p.y-=42*dt;}
    effects=effects.filter(p=>p.life>0);numbers=numbers.filter(p=>p.life>0);stains=stains.filter(p=>p.life>0);trails=trails.filter(p=>p.life>0);
    shake*=Math.exp(-dt*20);flash*=Math.exp(-dt*25);
    gunKick*=Math.exp(-dt*16);camera.kick*=Math.exp(-dt*11);
    const charging=input&&['fist','hammer','railgun','blackhole'].includes(behavior);
    const pull=charging?-Math.min(input.time/(spec().chargeTime||1.1),1)*.12*settings.zoom:0;
    const zoomTarget=camera.kick+pull;
    camera.zv+=((zoomTarget-camera.zoom)*150-camera.zv*15)*dt;
    camera.zoom=clamp(camera.zoom+camera.zv*dt,-.35,.65);
    camera.vx+=(-camera.x*180-camera.vx*22)*dt;camera.vy+=(-camera.y*180-camera.vy*22)*dt;
    camera.x+=camera.vx*dt;camera.y+=camera.vy*dt;
  }
  function frame(time) {
    raf=0;if(!active) return;
    const elapsed=lastTime?Math.min(.05,(time-lastTime)/1000):0;lastTime=time;
    visuals(elapsed);cooldown=Math.max(0,cooldown-elapsed);
    comboLeft=Math.max(0,comboLeft-elapsed);if(!comboLeft&&combo) {combo=0;hooks.onCombo?.(0,0);}
    if(combo) hooks.onCombo?.(combo,comboLeft/2.1);
    if(freeze>0) freeze=Math.max(0,freeze-elapsed);
    else if(targetEnabled) {
      accumulator+=elapsed*settings.slowMotion;
      while(accumulator>=STEP) {clock+=STEP;custom.update(STEP);updateInput(STEP);physics(STEP);accumulator-=STEP;}
    }
    render();hooks.onFrame?.();raf=requestAnimationFrame(frame);
  }
  function resize() {
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    width=rect.width;height=rect.height;const dpr=Math.min(window.devicePixelRatio||1,transparentSurface?4:2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    scale=Math.min(width/WORLD_W,height/WORLD_H);offsetX=(width-WORLD_W*scale)/2;offsetY=(height-WORLD_H*scale)/2;
    render();
  }
  const attackText=text=>settings.swearMask?'*'.repeat(Math.max(1,Array.from(text).length)):text;
  function drawBody(c,b,position=true) {
    if(b.visible===false||b.opacity===0)return;
    c.save();if(position){c.translate(b.x,b.y);c.rotate(b.angle);}
    if(position&&b.recoil>0){const squeeze=Math.sin(b.recoil/.16*Math.PI)*.16;c.scale(1+squeeze,1-squeeze*.7);}
    if(b.fragment) {c.drawImage(settings.swearMask?b.maskedSnapshot:b.snapshot,b.sx,b.sy,b.sw,b.sh,-b.w/2,-b.h/2,b.w,b.h);c.restore();return;}
    clipPart(c,b,-b.w/2,-b.h/2,b.w,b.h);c.globalAlpha*=b.opacity??1;
    const paint=()=>{
      if(!b.paint?.length)return;
      c.save();c.beginPath();c.rect(-b.w/2,-b.h/2,b.w,b.h);c.clip();
      for(const p of b.paint){c.save();c.translate(p.x,p.y);c.rotate(p.angle);c.globalAlpha*=(p.kind==='splat'?settings.liquidAlpha:.8);c.fillStyle=p.color;if(p.kind==='splat'){for(let i=0;i<6;i++){const a=i*1.05;c.beginPath();c.ellipse(Math.cos(a)*p.r*.45,Math.sin(a)*p.r*.3,p.r*(.3+i*.04),p.r*.27,a,0,Math.PI*2);c.fill();}c.restore();continue;}c.font='900 14px "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif';c.textAlign='center';c.fillText(attackText(p.text),0,0);c.fillRect(-2,0,2,18);c.restore();}c.restore();
    };
    const skin=frameAt(textures,sequences,b.name,clock)||(b.name==='head'?target:null);
    if(skin) {
      drawPartImage(c,skin,b,-b.w/2,-b.h/2,b.w,b.h,false);
      paint();
      c.restore();return;
    }
    c.save();c.scale(b.flipX?-1:1,b.flipY?-1:1);
    const flashBody=settings.flash&&b.damageFlash>0;
    c.fillStyle=b.stun>0?'#25222e':flashBody?'#dad4c9':b.name==='torso'?'#393935':'#44443f';
    c.strokeStyle=b.detached?settings.liquidColor:'#77756d';c.lineWidth=1.4;
    c.beginPath();if(b.r)c.arc(0,0,b.r,0,Math.PI*2);else c.roundRect(-b.w/2,-b.h/2,b.w,b.h,Math.min(7,b.w/3));c.fill();
    c.stroke();
    if(b.name==='head'&&!target) {
      c.fillStyle='#d5d1c7';c.fillRect(-13,-7,7,4);c.fillRect(6,-7,7,4);c.fillRect(-7,11,14,2);
    } else if(b.name==='torso') {
      c.strokeStyle='#939083';c.lineWidth=1;c.beginPath();c.moveTo(-16,-18);c.lineTo(16,-18);c.moveTo(0,-18);c.lineTo(0,17);c.stroke();
      c.fillStyle=settings.liquidColor;c.fillRect(-3,-3,6,6);
      if(b.hp<65) {c.strokeStyle=settings.liquidColor;c.beginPath();c.moveTo(-20,-5);c.lineTo(-3,5);c.lineTo(-8,15);c.lineTo(17,25);c.stroke();}
    }
    if(b.stun>0) {
      c.strokeStyle='#e6e0ff';c.lineWidth=1.7;c.beginPath();c.moveTo(0,-b.h*.34);c.lineTo(-3,-b.h*.05);c.lineTo(3,b.h*.12);c.lineTo(0,b.h*.35);
      for(let i=-1;i<=1;i++){const y=i*b.h*.16;c.moveTo(-b.w*.3,y-4);c.lineTo(0,y);c.lineTo(b.w*.3,y-4);}c.stroke();
      c.fillStyle=color('shock');for(const y of [-b.h*.3,0,b.h*.3]){c.beginPath();c.arc(0,y,2,0,Math.PI*2);c.fill();}
    }
    c.restore();paint();c.restore();
  }
  function drawClaw(c,x,y,angle,opening=10) {
    c.save();c.translate(x,y);c.rotate(angle);c.strokeStyle='#eee0cd';c.lineWidth=3;
    for(const side of [-1,1]){c.beginPath();c.moveTo(-16,side*opening);c.lineTo(3,side*opening);c.lineTo(11,side*(opening-6));c.stroke();}
    c.fillStyle='#82786a';c.fillRect(-25,-7,12,14);c.restore();
  }
  function drawVortex(x,y,radius,time,foreground=false) {
    ctx.save();ctx.translate(x,y);
    const core=14+Math.min(time,1.6)*16;
    if(!foreground&&settings.energyFx) {
      const halo=ctx.createRadialGradient(0,0,core,0,0,radius);halo.addColorStop(0,'rgba(193,155,221,.2)');halo.addColorStop(.5,'rgba(109,81,142,.09)');halo.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=halo;ctx.fillRect(-radius,-radius,radius*2,radius*2);
      ctx.strokeStyle='#a08bc3';ctx.lineWidth=1;
      const streams=Math.round(24*settings.energyFx);
      for(let i=0;i<streams;i++) {
        ctx.globalAlpha=.18+(i%4)*.1;ctx.beginPath();
        for(let k=0;k<18;k++){const f=k/17,r=core+(radius-core)*f,a=i/streams*Math.PI*2+clock*3-f*3.5;const px=Math.cos(a)*r,py=Math.sin(a)*r*.75;k?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.stroke();
      }
      ctx.globalAlpha=1;
    }
    if(foreground) {
      ctx.fillStyle='#050505';ctx.beginPath();ctx.arc(0,0,core,0,Math.PI*2);ctx.fill();
      if(settings.energyFx){ctx.strokeStyle='#d5c5ea';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,core+3,0,Math.PI*2);ctx.stroke();
        for(let i=0;i<5;i++){ctx.strokeStyle=i%2?'#bba5d7':'#d5b183';ctx.globalAlpha=.7-i*.1;ctx.beginPath();ctx.ellipse(0,0,core+12+i*6,5+i*3,-.28+Math.sin(clock)*.08,clock*3+i,clock*3+i+Math.PI*1.7);ctx.stroke();}}
    }
    ctx.restore();
  }
  function drawSpecialEffect(e,t) {
    const c=ctx,size=e.size;
    if(e.kind==='graffiti') {
      c.rotate(-e.angle);c.font=`900 ${Math.round(size*(.65+t*.3))}px "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`;c.textAlign='center';c.textBaseline='middle';c.lineWidth=4;c.strokeStyle=palette.stage;c.strokeText(e.kind==='graffiti'&&e.text!==i18nText("combat.009")?attackText(e.text):e.text,0,-t*18);c.fillText(e.kind==='graffiti'&&e.text!==i18nText("combat.009")?attackText(e.text):e.text,0,-t*18);
      c.lineWidth=2;for(let i=0;i<7;i++){const a=i*Math.PI*2/7;c.beginPath();c.moveTo(Math.cos(a)*size*.6,Math.sin(a)*size*.6);c.lineTo(Math.cos(a)*size*(.8+t),Math.sin(a)*size*(.8+t));c.stroke();}
    } else if(e.kind==='scorch') {
      c.globalAlpha=Math.min(.8,e.life);c.fillStyle=e.color;c.beginPath();c.ellipse(0,0,size*.32,size,0,0,Math.PI*2);c.fill();
    } else if(e.kind==='wallFire') {
      // A hemispherical fire plume projects inward from the contacted surface.
      if(!e.rail&&t>.2) {
        c.fillStyle='#696051';c.globalAlpha=(1-t)*.23;
        for(let i=-2;i<=2;i++){c.beginPath();c.ellipse(size*t*.55, i*size*.14,size*(.12+t*.3),size*(.1+t*.2),0,0,Math.PI*2);c.fill();}
      }
      c.globalAlpha=1-t;c.globalCompositeOperation='screen';
      const r=Math.max(1,size*(.18+Math.sin(Math.min(1,t*1.6)*Math.PI)*.82));
      const glow=c.createRadialGradient(0,0,0,0,0,r);
      glow.addColorStop(0,e.rail?'#eaffff':'#fff7d8');glow.addColorStop(.16,e.color);glow.addColorStop(.5,e.rail?'#237fa580':'#e7541680');glow.addColorStop(1,'#00000000');
      c.fillStyle=glow;c.fillRect(0,-r,r,r*2);
      for(let i=-4;i<=4;i++) {
        c.save();c.rotate(i*.19+Math.sin(e.seed+i)*.1);
        const reach=r*(.7+(Math.sin(i*7+e.seed)+1)*.3),w=(1-t)*size*.075;
        c.fillStyle=i%2?e.color:'#fff1c5';c.globalAlpha=(1-t)*.85;
        c.beginPath();c.moveTo(0,-w);c.quadraticCurveTo(reach*.5,-w*2,reach,Math.sin(i+t*12)*w);c.quadraticCurveTo(reach*.4,w*2,0,w);c.fill();c.restore();
      }
    } else if(e.kind==='wallShock') {
      const r=size*Math.sqrt(t);c.lineWidth=5*(1-t)+1;c.beginPath();c.ellipse(0,0,r*.6,r,0,-Math.PI/2,Math.PI/2);c.stroke();
      for(let i=-4;i<=4;i++){c.save();c.rotate(i*.3);c.beginPath();c.moveTo(r*.2,0);c.lineTo(r*.6,Math.sin(i+e.seed)*14);c.lineTo(r,0);c.stroke();c.restore();}
    } else if(e.kind==='impact') {
      c.lineWidth=3*(1-t);for(let i=0;i<10;i++){const a=i*Math.PI/5;const r=size*(.3+t);c.beginPath();c.moveTo(Math.cos(a)*r*.2,Math.sin(a)*r*.2);c.lineTo(Math.cos(a)*r,Math.sin(a)*r*(i%2?.65:1));c.stroke();}
    } else if(e.kind==='tracer'||e.kind==='rail') {
      c.globalCompositeOperation='screen';const rail=e.kind==='rail';
      if(rail){c.globalAlpha=(1-t)*.3;c.lineWidth=24+(e.charge||0)*36;c.beginPath();c.moveTo(0,0);c.lineTo(size,0);c.stroke();c.globalAlpha=1-t;}
      c.lineWidth=rail?8:2;c.beginPath();c.moveTo(0,0);c.lineTo(size,0);c.stroke();
      c.strokeStyle='#fff9e8';c.lineWidth=rail?2:1;c.stroke();
      if(rail&&settings.energyFx){c.strokeStyle=e.color;c.lineWidth=1;for(const side of [-1,1]){c.beginPath();for(let x=0;x<size;x+=6)c.lineTo(x,Math.sin(x*.1-t*20)*8*side);c.stroke();}}
    } else if(e.kind==='muzzle') {
      c.globalCompositeOperation='screen';c.beginPath();c.moveTo(-5,-7);c.lineTo(size*.6,-size*.25);c.lineTo(size*.3,-4);c.lineTo(size,0);c.lineTo(size*.3,5);c.lineTo(size*.6,size*.25);c.lineTo(-5,7);c.closePath();c.fill();c.fillStyle='#fff9df';c.beginPath();c.arc(0,0,7*(1-t),0,Math.PI*2);c.fill();
    } else if(e.kind==='ricochet') {
      for(let i=-2;i<=2;i++){const a=i*.4;c.beginPath();c.moveTo(0,0);c.lineTo(Math.cos(a)*size*t,Math.sin(a)*size*t);c.stroke();}
    } else if(e.kind==='lightning') {
      if(!settings.energyFx)return true;
      const points=[];for(let x=0;x<size;x+=10)points.push([x,Math.sin(x*.72+e.seed+Math.floor(t*7))*8*e.strength]);points.push([size,0]);
      const path=()=>{c.beginPath();c.moveTo(0,0);for(const [x,y]of points)c.lineTo(x,y);c.stroke();};
      c.globalCompositeOperation='screen';c.globalAlpha=(1-t)*.23;c.lineWidth=9;path();c.globalAlpha=1-t;c.lineWidth=2.5;path();c.strokeStyle='#faf5ff';c.lineWidth=.9;path();
      for(let i=3;i<points.length-1;i+=4){const [x,y]=points[i];c.beginPath();c.moveTo(x,y);c.lineTo(x+8,y+18);c.lineTo(x+20,y+12);c.lineTo(x+16,y+35);c.stroke();}
    } else if(e.kind==='teslaNode') {
      if(!settings.energyFx)return true;
      c.rotate(e.seed+t*4);c.lineWidth=1.2;c.strokeRect(-size*.5,-size*.5,size,size);c.beginPath();c.arc(0,0,size*(.5+t*.5),0,Math.PI*2);c.stroke();
    } else if(e.kind==='teslaBurst') {
      const r=size*Math.sqrt(t);c.lineWidth=2;c.beginPath();c.ellipse(0,0,r,r*.65,0,0,Math.PI*2);c.stroke();
      if(settings.energyFx)for(let i=0;i<14;i++){const a=i/14*Math.PI*2;c.save();c.rotate(a);c.beginPath();c.moveTo(r*.2,0);c.lineTo(r*.5,Math.sin(i+e.seed)*15);c.lineTo(r*.65,-10);c.lineTo(r,0);c.stroke();c.restore();}
    } else if(e.kind==='rip') {
      const gap=Math.sin(t*Math.PI)*20;c.fillStyle='#090807';c.beginPath();c.moveTo(-size*.6,-gap);for(let i=0;i<12;i++)c.lineTo(-size*.6+i*size*.1,(i%2?-1:1)*4-gap);for(let i=11;i>=0;i--)c.lineTo(-size*.6+i*size*.1,(i%2?1:-1)*4+gap);c.closePath();c.fill();c.stroke();
      if(settings.energyFx)for(let i=-4;i<=4;i++){const x=i*size*.09;c.beginPath();c.moveTo(x,-gap-4);c.quadraticCurveTo(x+Math.sin(i+e.seed)*12,0,x+7,gap+4);c.stroke();}
      drawClaw(c,-size*(.3+t*.6),0,0,12);drawClaw(c,size*(.3+t*.6),0,Math.PI,12);
    } else if(e.kind==='shredBloom') {
      for(let i=0;i<7;i++){c.save();c.rotate(i*Math.PI/3.5+t*.8);c.beginPath();c.moveTo(size*t*.2,-10);c.quadraticCurveTo(size*t*.7,-25,size*(.3+t),0);c.stroke();c.restore();}
    } else if(e.kind==='collapse') {
      c.lineWidth=3;c.beginPath();c.ellipse(0,0,Math.max(1,size*(1-t)),Math.max(1,size*(1-t)*.45),t*2,0,Math.PI*2);c.stroke();
      c.fillStyle='#060507';c.beginPath();c.arc(0,0,20+t*30,0,Math.PI*2);c.fill();
    } else if(e.kind==='nova') {
      c.globalCompositeOperation='screen';const r=Math.max(1,size*Math.sqrt(t));c.lineWidth=5*(1-t)+1;c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.stroke();c.lineWidth=1;c.beginPath();c.ellipse(0,0,r*1.2,r*.24,-.2,0,Math.PI*2);c.stroke();
      if(settings.energyFx)for(let i=0;i<16;i++){c.save();c.rotate(i*Math.PI/8+e.seed);c.beginPath();c.moveTo(r*.35,0);c.quadraticCurveTo(r*.7,35*(1-t),r,15);c.stroke();c.restore();}
    }else return false;
    return true;
  }
  function render() {
    if(!ctx)return;
    const dpr=canvas.width/width||1;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    if(!transparentSurface){ctx.fillStyle=palette.stage;ctx.fillRect(0,0,width,height);}
    view.x=camera.x+(WORLD_W/2-camera.focusX)*camera.zoom+(Math.random()-.5)*shake;view.y=camera.y+(WORLD_H/2-camera.focusY)*camera.zoom+(Math.random()-.5)*shake;view.zoom=1+camera.zoom;
    if(transparentSurface){view.x=0;view.y=0;view.zoom=1;}
    ctx.save();ctx.translate(offsetX+view.x*scale,offsetY+view.y*scale);ctx.scale(scale,scale);
    ctx.translate(WORLD_W/2,WORLD_H/2);ctx.scale(view.zoom,view.zoom);ctx.translate(-WORLD_W/2,-WORLD_H/2);
    if(!transparentSurface){ctx.strokeStyle=palette.grid;ctx.lineWidth=1;
    for(let x=30;x<WORLD_W;x+=40){ctx.beginPath();ctx.moveTo(x,75);ctx.lineTo(x,FLOOR);ctx.stroke();}
    for(let y=83;y<FLOOR;y+=40){ctx.beginPath();ctx.moveTo(12,y);ctx.lineTo(WORLD_W-12,y);ctx.stroke();}
    ctx.fillStyle=palette.floor;ctx.fillRect(12,FLOOR,WORLD_W-24,9);ctx.strokeStyle=palette.floorLine;ctx.beginPath();ctx.moveTo(12,FLOOR);ctx.lineTo(WORLD_W-12,FLOOR);ctx.stroke();}
    if(!targetEnabled){ctx.font='13px Consolas, "Microsoft YaHei", "Noto Sans SC", monospace';ctx.fillStyle=palette.muted;ctx.textAlign='center';ctx.fillText(i18nText("combat.013"),WORLD_W/2,WORLD_H/2);ctx.restore();return;}
    for(const s of stains){ctx.globalAlpha=Math.min(.68,s.life/4)*(s.text?1:settings.liquidAlpha);ctx.fillStyle=s.color;ctx.beginPath();ctx.ellipse(s.x,s.y,s.r*2,s.r*.7,0,0,Math.PI*2);ctx.fill();if(s.text){ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.angle||0);ctx.font='900 19px "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif';ctx.textAlign='center';ctx.fillText(attackText(s.text),0,0);ctx.fillRect(-3,3,2,18);ctx.restore();} }ctx.globalAlpha=1;
    if(input?.field)drawVortex(pointer.x,pointer.y,(spec().radius||100)+Math.min(input.time,1.6)*80,input.time);
    for(const blast of blasts)drawVortex(blast.x,blast.y,blast.radius,1.6+blast.age);
    const rope=ropeGeometry();if(rope){ctx.strokeStyle='#a99978';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(rope.anchor.x,rope.anchor.y);ctx.lineTo(rope.end.x,rope.end.y);ctx.stroke();ctx.beginPath();ctx.arc(rope.end.x,rope.end.y,4,0,Math.PI*2);ctx.stroke();}
    for(const j of joints) if(j.alive&&j.a.visible!==false&&j.b.visible!==false&&j.a.opacity!==0&&j.b.opacity!==0) {const a=worldAnchor(j.a,j.ax,j.ay),b=worldAnchor(j.b,j.bx,j.by);ctx.strokeStyle='#aaa394';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    for(const b of orderedBodies())if(!b.dead)drawBody(ctx,b);
    for(const p of projectiles){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(p.vy,p.vx)*.15);ctx.fillStyle=p.color;ctx.font=`900 ${p.size}px "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`;ctx.textAlign='center';ctx.fillText(attackText(p.text),0,0);ctx.strokeStyle=p.color;ctx.globalAlpha=.35;ctx.beginPath();ctx.moveTo(-p.vx*.03,-p.vy*.03);ctx.lineTo(0,0);ctx.stroke();ctx.restore();}
    if(input?.field)drawVortex(pointer.x,pointer.y,(spec().radius||100)+Math.min(input.time,1.6)*80,input.time,true);
    for(const blast of blasts)drawVortex(blast.x,blast.y,blast.radius,1.6+blast.age,true);
    const head=alive().find(b=>b.name==='head');
    if(head) {
      const label=(settings.modelName||model).slice(0,55);ctx.font='11px Consolas, "Microsoft YaHei", "Noto Sans SC", monospace';
      const w=Math.min(WORLD_W-30,ctx.measureText(label).width+18),x=clamp(head.x,w/2+10,WORLD_W-w/2-10),y=clamp(head.y-head.h/2-21,55,FLOOR-24);
      ctx.fillStyle=palette.surface;ctx.strokeStyle=palette.border;ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x-w/2,y-11,w,22,4);ctx.fill();ctx.stroke();
      ctx.fillStyle=palette.text;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,y,w-10);
    }
    for(const trail of trails) {ctx.globalAlpha=trail.life/.16;ctx.strokeStyle=trail.color;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(trail.a.x,trail.a.y);ctx.lineTo(trail.b.x,trail.b.y);ctx.stroke();}ctx.globalAlpha=1;
    if(input) {
      const charge=clamp(input.time/(spec().chargeTime||1.1),0,1);
      if(behavior==='blackhole'&&input.field) {
        const radius=(spec().radius||100)+Math.min(input.time,1.6)*80;ctx.strokeStyle='#6f607d';ctx.lineWidth=1;ctx.setLineDash([2,12]);ctx.beginPath();ctx.arc(pointer.x,pointer.y,radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      } else if((behavior==='grab'||behavior==='shred')&&input.b&&!input.b.dead) {
        const a=worldAnchor(input.b,input.offset.x,input.offset.y);ctx.strokeStyle=behavior==='shred'?'#df9c9c':'#c7c5bf';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(pointer.x,pointer.y);ctx.stroke();
        if(behavior==='shred') {
          const dx=pointer.x-a.x,dy=pointer.y-a.y,len=Math.hypot(dx,dy)||1,angle=Math.atan2(dy,dx),tension=input.tear;
          drawClaw(ctx,a.x,a.y,angle,9+8*tension);drawClaw(ctx,pointer.x,pointer.y,angle+Math.PI,9+8*tension);
          if(settings.energyFx)for(let strand=-2;strand<=2;strand++){ctx.beginPath();for(let i=0;i<=16;i++){const f=i/16,offset=Math.sin(f*Math.PI*8+clock*8+strand)*5*(1-tension)+strand*3;const x=a.x+dx*f-dy/len*offset,y=a.y+dy*f+dx/len*offset;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.lineWidth=1;ctx.stroke();}
          ctx.lineWidth=3;ctx.beginPath();ctx.arc(pointer.x,pointer.y,30,-Math.PI/2,-Math.PI/2+tension*Math.PI*2);ctx.stroke();
        }
      } else if(behavior==='shock') {
        ctx.save();ctx.translate(pointer.x,pointer.y);ctx.rotate(clock*3);ctx.strokeStyle=color('shock');ctx.lineWidth=2;
        for(let i=0;i<3;i++){ctx.rotate(Math.PI*2/3);ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(26,0);ctx.lineTo(29,6);ctx.stroke();}
        ctx.beginPath();ctx.arc(0,0,11+(input.energy||0)*7,0,Math.PI*2);ctx.stroke();ctx.restore();
      } else if(behavior==='fist'||behavior==='hammer') {
        ctx.strokeStyle=catalog[weapon].color;ctx.lineWidth=2+charge*3;ctx.beginPath();ctx.arc(pointer.x,pointer.y,18+charge*20,-Math.PI/2,-Math.PI/2+charge*Math.PI*2);ctx.stroke();
        if(behavior==='hammer') {ctx.save();ctx.translate(pointer.x,pointer.y-32-charge*30);ctx.rotate(-.3+charge*.5);ctx.fillStyle='#aaa497';ctx.fillRect(-4,0,8,40);ctx.fillRect(-25,-13,50,26);ctx.restore();}
      } else if(behavior==='chainsaw') {ctx.save();ctx.translate(pointer.x,pointer.y);ctx.rotate(-.6);ctx.fillStyle='#b5a88d';ctx.fillRect(-7,-28,14,56);ctx.strokeStyle='#e6b764';ctx.lineWidth=2;ctx.strokeRect(-10,-30,20,60);ctx.restore();}
    }
    if(wGun()) {
      const g=gunGeometry(),charge=behavior==='railgun'&&input?clamp(input.time/(spec().chargeTime||1.1),0,1):0;
      ctx.save();ctx.translate(g.x-Math.cos(g.angle)*gunKick,g.y-Math.sin(g.angle)*gunKick);ctx.rotate(g.angle-gunKick*.006);
      ctx.fillStyle='#b5ad9d';ctx.strokeStyle='#ddd1b9';ctx.lineWidth=1.2;
      ctx.fillRect(-12,-7,50,14);ctx.fillRect(-3,5,12,23);ctx.fillStyle='#514c43';ctx.fillRect(-8,-5,28,10);ctx.fillRect(25,-5,20,10);
      if(behavior==='smg'){ctx.fillRect(-20,-5,12,12);ctx.fillRect(14,6,7,19);}
      if(behavior==='shotgun'){ctx.fillStyle='#c5b49a';ctx.fillRect(6,7,28,6);ctx.fillRect(34,-5,13,10);}
      if(behavior==='railgun'){ctx.strokeStyle=color('railgun');for(let i=0;i<4;i++){ctx.globalAlpha=.35+charge*.65;ctx.strokeRect(3+i*9,-11,5,22);}ctx.globalAlpha=1;}
      ctx.restore();
      ctx.strokeStyle=catalog[weapon].color;ctx.lineWidth=1;ctx.beginPath();ctx.arc(pointer.x,pointer.y,9+gunKick*.2,0,Math.PI*2);ctx.stroke();
      for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(pointer.x+side*13,pointer.y);ctx.lineTo(pointer.x+side*20,pointer.y);ctx.moveTo(pointer.x,pointer.y+side*13);ctx.lineTo(pointer.x,pointer.y+side*20);ctx.stroke();}
      if(behavior==='railgun'&&input){ctx.globalAlpha=.2+charge*.4;ctx.setLineDash([4,9]);ctx.beginPath();ctx.moveTo(g.muzzle.x,g.muzzle.y);ctx.lineTo(pointer.x,pointer.y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;ctx.beginPath();ctx.arc(g.muzzle.x,g.muzzle.y,10+charge*20,-clock*5,-clock*5+charge*Math.PI*2);ctx.stroke();}
    }
    for(const p of particles) {ctx.globalAlpha=clamp(p.life*2,0,1)*(p.kind==='liquid'?settings.liquidAlpha:1);ctx.fillStyle=p.color;if(p.kind==='spark'){ctx.strokeStyle=p.color;ctx.lineWidth=p.size;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.02,p.y-p.vy*.02);ctx.stroke();}else if(p.kind==='debris'){ctx.fillRect(p.x,p.y,p.size*2,p.size);}else if(p.kind==='liquid'&&particleImage){ctx.drawImage(particleImage,p.x-p.size*2,p.y-p.size*2,p.size*4,p.size*4);}else if(p.kind==='casing'){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.life*18);ctx.fillRect(-4,-2,8,4);ctx.restore();}else{ctx.beginPath();ctx.ellipse(p.x,p.y,p.size,p.size*1.4,Math.atan2(p.vy,p.vx),0,Math.PI*2);ctx.fill();}}ctx.globalAlpha=1;
    for(const e of effects) {
      const t=1-e.life/e.max;ctx.save();ctx.translate(e.x,e.y);ctx.rotate(e.angle);ctx.strokeStyle=e.color;ctx.fillStyle=e.color;ctx.globalAlpha=1-t;ctx.lineWidth=2*(1-t)+.5;ctx.beginPath();
      if(drawSpecialEffect(e,t)) { /* specialized multi-stage feedback */ }
      else if(e.kind==='cut') {ctx.moveTo(-e.size*(.3+t),-5);ctx.quadraticCurveTo(0,15,e.size*(.3+t),5);ctx.stroke();}
      else if(e.kind==='arc') {ctx.moveTo(0,0);for(let x=12;x<e.size;x+=12)ctx.lineTo(x,(Math.random()-.5)*18);ctx.lineTo(e.size,0);ctx.stroke();}
      else if(e.kind==='crack') {for(let i=0;i<7;i++){const a=i/7*Math.PI*2;ctx.moveTo(Math.cos(a)*9,Math.sin(a)*9);ctx.lineTo(Math.cos(a+.1)*e.size*.5,Math.sin(a+.1)*e.size*.5);ctx.lineTo(Math.cos(a)*e.size,Math.sin(a)*e.size);}ctx.stroke();}
      else if(e.kind==='fist') {ctx.roundRect(-e.size,-e.size*.6,e.size*1.7,e.size*1.2,8);ctx.fill();}
      else if(e.kind==='hammer') {ctx.fillRect(-32,-22-t*20,64,30);ctx.fillRect(-5,-10-t*20,10,40);}
      else if(e.kind==='saw') {for(let i=0;i<10;i++){const a=i*Math.PI/5+clock*20;ctx.moveTo(Math.cos(a)*e.size,Math.sin(a)*e.size);ctx.lineTo(Math.cos(a+.2)*(e.size+8),Math.sin(a+.2)*(e.size+8));}ctx.stroke();}
      else {ctx.ellipse(0,0,Math.max(1,e.size*t),Math.max(1,e.size*t*(e.kind==='miss'?.3:1)),0,0,Math.PI*2);ctx.stroke();}
      ctx.restore();
    }
    ctx.textAlign='center';ctx.textBaseline='middle';
    custom.draw(ctx);
    const sprite=spriteGeometry(),spriteImage=sprite&&weaponImages[Math.floor(clock*sprite.appearance.fps)%weaponImages.length];
    if(spriteImage){const a=sprite.appearance;ctx.save();ctx.translate(sprite.x,sprite.y);ctx.rotate(sprite.angle);ctx.drawImage(spriteImage,-a.pivotX*a.width,-a.pivotY*a.height,a.width,a.height);ctx.restore();}

    for(const n of numbers) {ctx.globalAlpha=clamp(n.life*3,0,1);ctx.fillStyle=palette.text;ctx.font='bold 19px Consolas, "Microsoft YaHei", "Noto Sans SC", monospace';ctx.fillText(n.text,n.x,n.y);if(n.label){ctx.font='9px Consolas, "Microsoft YaHei", "Noto Sans SC", monospace';ctx.fillText((catalog[n.source]?.behavior==='swear'||n.source==='swear')?attackText(n.label):n.label,n.x,n.y-19);}}ctx.globalAlpha=1;
    if(!alive().length) {ctx.font='12px Consolas, "Microsoft YaHei", "Noto Sans SC", monospace';ctx.fillStyle=palette.muted;ctx.fillText(i18nText("combat.014"),WORLD_W/2,WORLD_H/2);}
    const speech=dialogue.current(clock),speaker=root()||alive()[0];
    if(speech&&speaker){const x=clamp(speaker.x,125,WORLD_W-125),y=clamp(speaker.y-90,32,FLOOR-40);ctx.save();ctx.font='600 16px "Microsoft YaHei", "Noto Sans SC", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const text=speech.text;const w=Math.min(260,ctx.measureText(text).width+28);ctx.fillStyle=palette.stage;ctx.strokeStyle=palette.muted;ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x-w/2,y-20,w,40,12);ctx.fill();ctx.stroke();ctx.fillStyle=palette.text;ctx.fillText(text,x,y,w-20);ctx.restore();}
    ctx.restore();
    if(flash>0&&settings.flash){ctx.fillStyle=`rgba(239,229,205,${flash})`;ctx.fillRect(0,0,width,height);}
  }
  function setActive(value) {
    active=!!value;custom.setActive(active);cancelInput();lastTime=0;accumulator=0;
    if(!active) {if(raf)cancelAnimationFrame(raf);raf=0;blasts=[];for(const source of playingSounds)source.stop();audio?.suspend().catch(()=>{});}
    else {resize();if(!raf)raf=requestAnimationFrame(frame);}
  }
  function updateSettings(value) {
    const previous=settings;settings=normalizeSettings(value);catalog=weaponCatalog(settings);if(!Object.hasOwn(catalog,weapon))selectWeapon('fist');else behavior=catalog[weapon].behavior||weapon;custom.configure(catalog[weapon]);loadWeaponImages();palette=resolveTheme(settings.theme,systemTheme.matches);
    const sources=new Set(Object.values(settings.weaponSounds).flatMap(Object.values));
    for(const key of soundBuffers.keys())if(!sources.has(key))soundBuffers.delete(key);
    if(!settings.volume)for(const source of playingSounds)source.stop();
    if(settings.targetScale!==previous.targetScale)reset();else if(JSON.stringify(settings.rope)!==JSON.stringify(previous.rope))configureRope();
    if(!settings.flash)flash=0;if(!settings.numbers)numbers=[];if(!settings.trails)trails=[];
    if(!settings.shake){shake=0;camera.x=camera.y=camera.vx=camera.vy=0;}if(!settings.zoom)camera.zoom=camera.zv=camera.kick=0;
    if(particles.length>settings.particleLimit)particles.length=settings.particleLimit;
    loadParticleTexture();
    render();
  }
  function loadParticleTexture() {
    if(particleImageSource===settings.particleTexture)return;
    particleImageSource=settings.particleTexture;particleImage=null;
    const revision=++particleImageRevision;
    if(!particleImageSource)return;
    const img=new Image();img.onload=()=>{if(revision===particleImageRevision){particleImage=img;render();}};img.src=particleImageSource;
  }
  loadParticleTexture();
  listen(systemTheme,'change',()=>{palette=resolveTheme(settings.theme,systemTheme.matches);render();});
  listen(window,'keydown',e=>{if(e.key==='Escape'&&ropePicking){ropePicking=false;hooks.onRopeAttachment?.(null);}});
  listen(canvas,'contextmenu',e=>e.preventDefault());
  listen(canvas,'pointerdown',down);listen(canvas,'pointermove',move);listen(canvas,'pointerup',release);
  listen(canvas,'pointercancel',cancelInput);listen(canvas,'lostpointercapture',cancelInput);
  listen(window,'blur',cancelInput);listen(document,'visibilitychange',()=>{if(document.hidden)cancelInput();});
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  reset();resize();
  const petCanvas=document.createElement('canvas');petCanvas.width=300;petCanvas.height=280;
  function petFrame() {
    const c=petCanvas.getContext('2d');c.clearRect(0,0,300,280);
    const list=targetEnabled?orderedBodies().filter(b=>!b.dead&&bodyBounds(b)):[];let bounds={x:150,y:140,width:0,height:0};
    if(list.length){
      const minX=Math.min(...list.map(b=>b.x+bodyBounds(b).left)),maxX=Math.max(...list.map(b=>b.x+bodyBounds(b).right));
      const minY=Math.min(...list.map(b=>b.y+bodyBounds(b).top)),maxY=Math.max(...list.map(b=>b.y+bodyBounds(b).bottom));
      const k=Math.min(260/Math.max(1,maxX-minX),240/Math.max(1,maxY-minY),1.15);
      bounds={x:150-(maxX-minX)*k/2,y:140-(maxY-minY)*k/2,width:(maxX-minX)*k,height:(maxY-minY)*k};
      c.save();c.translate(150-(minX+maxX)*k/2,140-(minY+maxY)*k/2);c.scale(k,k);
      for(const j of joints)if(j.alive&&j.a.visible!==false&&j.b.visible!==false&&j.a.opacity!==0&&j.b.opacity!==0){const a=worldAnchor(j.a,j.ax,j.ay),b=worldAnchor(j.b,j.bx,j.by);c.strokeStyle='#aaa394';c.lineWidth=4;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
      for(const b of list)drawBody(c,b);c.restore();
      const rgba=c.getImageData(0,0,300,280).data;let left=300,right=-1,top=280,bottom=-1;
      for(let y=0;y<280;y++)for(let x=0;x<300;x++)if(rgba[(y*300+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      bounds=right>=left?{x:left,y:top,width:right-left+1,height:bottom-top+1}:{x:150,y:140,width:0,height:0};
    }
    return {image:petCanvas.toDataURL('image/png'),bounds,bodies:list.length,paintedBodies:list.filter(b=>b.paint?.length).length,fragments:list.filter(b=>b.fragment).length,masked:settings.swearMask};
  }
  function exportState(){
    const images=[],indices=new Map(),imageId=image=>{if(!image)return null;if(!indices.has(image)){indices.set(image,images.length);const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;copy.getContext('2d').drawImage(image,0,0);images.push(copy.toDataURL('image/png'));}return indices.get(image);};
    return {version:1,width:WORLD_W,height:WORLD_H,weaponOrigin,rig,clock,combo,comboLeft,shots,nextId,targetEnabled,
      dialogue:dialogue.exportState(clock),images,bodies:alive().map(b=>{const {snapshot,maskedSnapshot,shapeKey,...plain}=b;return {...plain,snapshot:imageId(snapshot),maskedSnapshot:imageId(maskedSnapshot)};}),
      joints:joints.filter(j=>j.alive).map(({a,b,...j})=>({...j,a:a.id,b:b.id})),stains:stains.map(s=>({...s}))};
  }
  function contentBounds(tiled=false){
    const dpr=canvas.width/width||1,tiles=new Set(),tileSize=128;
    const px=x=>(offsetX+view.x*scale+(WORLD_W/2+(x-WORLD_W/2)*view.zoom)*scale)*dpr;
    const py=y=>(offsetY+view.y*scale+(WORLD_H/2+(y-WORLD_H/2)*view.zoom)*scale)*dpr;
    const mark=(x1,y1,x2,y2)=>{if(x2<0||y2<0||x1>=canvas.width||y1>=canvas.height)return;for(let y=Math.floor(Math.max(0,y1)/tileSize);y<=Math.floor(Math.min(canvas.height-1,y2)/tileSize);y++)for(let x=Math.floor(Math.max(0,x1)/tileSize);x<=Math.floor(Math.min(canvas.width-1,x2)/tileSize);x++)tiles.add(x+','+y);};
    const rectangles=()=>{const list=[...tiles].map(k=>{const [x,y]=k.split(',').map(n=>Number(n)*tileSize);return {x,y,width:Math.min(tileSize,canvas.width-x),height:Math.min(tileSize,canvas.height-y)};}).sort((a,b)=>a.y-b.y||a.x-b.x),merged=[];for(const r of list){const prev=merged.at(-1);if(prev&&prev.y===r.y&&prev.x+prev.width===r.x)prev.width+=r.width;else merged.push(r);}return merged;};
    if(flash>0&&settings.flash){if(!tiled)return {x:0,y:0,width:canvas.width,height:canvas.height};mark(0,0,canvas.width-1,canvas.height-1);return [...tiles].map(k=>{const [x,y]=k.split(',').map(n=>Number(n)*tileSize);return {x,y,width:Math.min(tileSize,canvas.width-x),height:Math.min(tileSize,canvas.height-y)};});}
    let left=WORLD_W,top=WORLD_H,right=0,bottom=0;
    const add=(x,y,rx=0,ry=rx)=>{left=Math.min(left,x-rx);top=Math.min(top,y-ry);right=Math.max(right,x+rx);bottom=Math.max(bottom,y+ry);if(tiled)mark(px(x-rx)-4,py(y-ry)-4,px(x+rx)+4,py(y+ry)+4);};
    const line=(a,b,r=12)=>{const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*scale*dpr/100));for(let i=0;i<=n;i++)add(a.x+(b.x-a.x)*i/n,a.y+(b.y-a.y)*i/n,r);};
    const speaking=dialogue.current(clock),speaker=root()||alive()[0];if(speaking&&speaker)add(clamp(speaker.x,125,WORLD_W-125),clamp(speaker.y-90,32,FLOOR-40),145,28);
    for(const b of alive())add(b.x,b.y,Math.hypot(b.w,b.h)*.7+18);
    const head=alive().find(b=>b.name==='head');if(head){const label=(settings.modelName||model).slice(0,55),w=Math.min(WORLD_W-30,ctx.measureText(label).width+36);add(clamp(head.x,w/2+10,WORLD_W-w/2-10),clamp(head.y-head.h/2-21,55,FLOOR-24),w/2+20,32);}
    for(const p of particles){add(p.x,p.y,p.size*5+8);if(p.kind==='spark')add(p.x-p.vx*.02,p.y-p.vy*.02,p.size+3);}
    for(const p of projectiles){add(p.x,p.y,Math.max(50,p.text.length*p.size));add(p.x-p.vx*.03,p.y-p.vy*.03,8);}
    for(const s of stains)add(s.x,s.y,Math.max(s.r*2+5,(s.text?.length||0)*9),30);
    for(const e of effects){if(['tracer','rail','lightning','arc'].includes(e.kind))line(e,{x:e.x+Math.cos(e.angle)*e.size,y:e.y+Math.sin(e.angle)*e.size},70);else add(e.x,e.y,e.size*2+60);}
    for(const n of numbers)add(n.x,n.y,Math.max(n.text.length,n.label?.length||0)*11+20,40);
    for(const t of trails)line(t.a,t.b,5);
    for(const b of blasts)add(b.x,b.y,b.radius*2+30);custom.bounds(add,line);
    if(input){add(pointer.x,pointer.y,input.field?280:110);if(input.b&&['grab','shred'].includes(behavior))line(input.b,pointer,30);}
    const sprite=spriteGeometry();if(sprite&&weaponImages.length){const a=sprite.appearance,c=Math.cos(sprite.angle),s=Math.sin(sprite.angle),corners=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>{const dx=(x-a.pivotX)*a.width,dy=(y-a.pivotY)*a.height;return {x:sprite.x+dx*c-dy*s,y:sprite.y+dx*s+dy*c};}),xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);add((Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2,(Math.max(...xs)-Math.min(...xs))/2+3,(Math.max(...ys)-Math.min(...ys))/2+3);}
    const rope=ropeGeometry();if(rope)line(rope.anchor,rope.end,6);
    if(wGun()){const g=gunGeometry();add(g.x,g.y,85);add(pointer.x,pointer.y,45);if(behavior==='railgun'&&input)line(g.muzzle,pointer,20);}
    if(!targetEnabled||!alive().length)add(WORLD_W/2,WORLD_H/2,180,40);
    if(tiled)return rectangles();
    const x=clamp(Math.floor(px(left))-4,0,canvas.width-1),y=clamp(Math.floor(py(top))-4,0,canvas.height-1);
    return {x,y,width:clamp(Math.ceil(px(right))+4,x+1,canvas.width)-x,height:clamp(Math.ceil(py(bottom))+4,y+1,canvas.height)-y};
  }
  async function importState(value,anchor){
    if(!value||value.version!==1||!Array.isArray(value.bodies)||value.bodies.length>256||!Array.isArray(value.images)||value.images.length>48)throw new Error(i18nText("combat.015"));
    const finite=(object,keys)=>object&&keys.every(key=>Number.isFinite(object[key]));
    const validMark=p=>finite(p,['x','y','r'])&&p.r>=0&&p.r<=1000&&typeof p.color==='string'&&/^#[\da-f]{6}([\da-f]{2})?$/i.test(p.color)&&(p.text===undefined||typeof p.text==='string'&&p.text.length<=40)&&(p.angle===undefined||Number.isFinite(p.angle));
    const ids=new Set();
    if(!finite(value,['width','height'])||value.width<320||value.height<240||!Array.isArray(value.joints)||value.joints.length>256||!Array.isArray(value.stains)||value.stains.length>240)throw new Error(i18nText("combat.016"));
    for(const b of value.bodies){
      if(!b||!Number.isSafeInteger(b.id)||b.id<0||b.id>1000000000||ids.has(b.id)||typeof b.name!=='string'||b.name.length>80||!finite(b,['x','y','w','h','vx','vy','angle','va','mass','inv','hp','wallAt','thrown','stun','damageFlash'])||b.w<=0||b.h<=0||b.w>Number.MAX_SAFE_INTEGER||b.h>Number.MAX_SAFE_INTEGER||b.mass<=0||b.inv<=0||b.paint!==undefined&&(!Array.isArray(b.paint)||b.paint.length>32||!b.paint.every(validMark)))throw new Error(i18nText("combat.017"));
      for(const key of ['snapshot','maskedSnapshot'])if(b[key]!==null&&(!Number.isSafeInteger(b[key])||b[key]<0||b[key]>=value.images.length))throw new Error(i18nText("combat.018"));
      if(b.drawOrder!==undefined&&(!Number.isSafeInteger(b.drawOrder)||Math.abs(b.drawOrder)>10000))throw new Error(i18nText('modeler.modelError'));
      const circleMask=b.fragment?(b.circleMask??b.mask):null;
      if(b.fragment&&(!finite(b,['sx','sy','sw','sh','ttl'])||b.sw<=0||b.sh<=0||circleMask&&!finite(circleMask,['x','y','r'])))throw new Error(i18nText("combat.018"));
      ids.add(b.id);
    }
    if(value.joints.some(j=>!finite(j,['a','b','ax','ay','bx','by','stress'])||!ids.has(j.a)||!ids.has(j.b))||!value.stains.every(p=>validMark(p)&&Number.isFinite(p.life)))throw new Error(i18nText("combat.019"));
    if(value.images.some(src=>typeof src!=='string'||src.length>1500000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src)))throw new Error(i18nText("combat.020"));
    const images=await Promise.all(value.images.map(src=>platform.loadImage?platform.loadImage(src):new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;})));
    const center=value.bodies.length?{x:value.bodies.reduce((n,b)=>n+b.x,0)/value.bodies.length,y:value.bodies.reduce((n,b)=>n+b.y,0)/value.bodies.length}:{x:value.width/2,y:value.height/2};
    const dx=anchor?anchor.x-center.x:(WORLD_W-value.width)/2,dy=anchor?anchor.y-center.y:(WORLD_H-value.height)/2;
    const next=value.bodies.map(b=>{
      // Legacy fragments stored their circular limit in mask; reserve mask for source UV polygons.
      const body={...b,x:clamp(b.x+dx,arenaBounds.left,arenaBounds.right),y:clamp(b.y+dy,arenaBounds.top,FLOOR),paint:(b.paint||[]).slice(-32),snapshot:images[b.snapshot],maskedSnapshot:images[b.maskedSnapshot]};
      if(b.fragment){body.circleMask=b.circleMask??b.mask??null;delete body.mask;}
      return body;
    });
    const byId=new Map(next.map(b=>[b.id,b]));rig=normalizeRig(value.rig);cancelInput();custom.clear();bodies=next;for(const b of bodies){const p=rig.find(p=>p.id===b.name);b.drawOrder=b.fragment?(b.drawOrder??0):rig.indexOf(p);delete b.layerOrder;delete b.shapeKey;if(p&&!b.fragment)Object.assign(b,{restAngle:p.rotation*Math.PI/180,shapeKey:JSON.stringify([p.crop,p.flipX,p.flipY,p.mask]),visible:p.visible,opacity:p.opacity,crop:p.crop,mask:p.mask,flipX:p.flipX,flipY:p.flipY});}layersDirty=true;
    joints=(value.joints||[]).filter(j=>byId.has(j.a)&&byId.has(j.b)).map(j=>({...j,a:byId.get(j.a),b:byId.get(j.b)}));
    clock=Number.isFinite(value.clock)?value.clock:0;dialogue.importState(value.dialogue,clock);combo=value.combo||0;comboLeft=value.comboLeft||0;shots=value.shots||0;nextId=Math.max(...next.map(b=>b.id+1),0);targetEnabled=value.targetEnabled!==false;
    stains=(value.stains||[]).slice(-180).map(s=>({...s,x:s.x+dx,y:s.y+dy}));weaponOrigin=value.weaponOrigin&&Number.isFinite(value.weaponOrigin.x)&&Number.isFinite(value.weaponOrigin.y)?{x:clamp(value.weaponOrigin.x+dx,arenaBounds.left,arenaBounds.right),y:clamp(value.weaponOrigin.y+dy,arenaBounds.top,FLOOR)}:null;configureRope();render();
  }
  return { pickRopeAttachment(){cancelInput();ropePicking=true;},setActive, selectWeapon, reset, resize, updateSettings, petFrame, exportState,importState,contentBounds,
    setDialogueOwner(id){dialogue.setOwner(id);},
    input(event){const e={...event,world:true,button:event.button??0,pointerId:1,preventDefault(){}};if(event.type==='teleport')teleportWeapon(e);else if(event.type==='down')down(e);else if(event.type==='move')move(e);else if(event.type==='up')release(e);else cancelInput();},
    setSurface(value){const w=clamp(value.width||700,320,8000),h=clamp(value.height||520,240,4500);WORLD_W=w;WORLD_H=h;transparentSurface=!!value.transparent;FLOOR=transparentSurface?h:483;Object.assign(arenaBounds,{left:transparentSurface?0:12,right:transparentSurface?w:w-12,top:transparentSurface?0:16});Object.assign(camera,{x:0,y:0,zoom:0,focusX:w/2,focusY:h/2});cancelInput();configureRope();resize();},
    setTargetEnabled(value){if(targetEnabled!==!!value){targetEnabled=!!value;reset();}},
    resetCombo(){combo=0;comboLeft=0;hooks.onCombo?.(0,0);},
    setTarget(image,skins={},animations={}){target=image;textures={...skins};sequences={...animations};render();},
    setRig(value){const next=normalizeRig(value);if(JSON.stringify(next)!==JSON.stringify(rig)){rig=next;reset();}},
    setModel(value){model=value||'deepseek-flash';},
    dispose(){weaponImageRevision++;setActive(false);observer.disconnect();cleanups.forEach(fn=>fn());audio?.close().catch(()=>{});},
    // Read-only snapshot for regression tests and diagnostics; no mutable engine objects escape.
    snapshot(){const {graph,appearance,...weaponInfo}=spec();return {weaponAppearance:appearance?{frames:appearance.frames.length,loaded:weaponImages.filter(Boolean).length,fps:appearance.fps,frame:Math.floor(clock*appearance.fps)%Math.max(1,appearance.frames.length),muzzle:spriteGeometry()?.muzzle}:null,weaponOrigin:{...gunOrigin()},rope:ropeGeometry()?{part:ropeGeometry().body.name,anchor:{...suspension.anchor},end:{...ropeGeometry().end},length:suspension.length}:null,world:{width:WORLD_W,height:WORLD_H,floor:FLOOR,transparent:transparentSurface,bounds:{...arenaBounds,bottom:FLOOR}},theme:{mode:palette.mode,palette:palette.palette,stage:palette.stage},weapon,behavior,custom:custom.snapshot(),weaponSpec:weaponInfo,speech:dialogue.current(clock),combo,active,targetEnabled,shots,view:{...view},camera:{...camera},textureParts:Object.keys(textures),particleTextureLoaded:!!particleImage,particleLimit:settings.particleLimit,flashEnabled:settings.flash,pendingBlasts:blasts.length,
      liquidAlpha:settings.liquidAlpha,projectiles:projectiles.map(p=>({text:attackText(p.text),x:p.x,y:p.y})),paintedBodies:alive().filter(b=>b.paint?.length).length,graffitiStains:stains.filter(s=>s.text).length,animationFrames:Object.fromEntries(Object.entries(sequences).map(([id,s])=>[id,Math.floor(clock*s.fps)%s.frames.length])),
      bodies:alive().map(b=>({id:b.id,name:b.name,x:b.x,y:b.y,vx:b.vx,vy:b.vy,angle:b.angle,fragment:b.fragment,detached:b.detached,w:b.w,h:b.h,r:b.r,collision:bodyBounds(b)})),
      joints:joints.length,particles:particles.length,liquidParticles:particles.filter(p=>p.kind==='liquid').length,effects:effects.length,effectKinds:[...new Set(effects.map(e=>e.kind))],stains:stains.length,charging:!!input};}
  };
}
