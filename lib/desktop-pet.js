import {getCatalogs,getLanguageRevision} from '../assets/i18n.js';
import {t as i18nText,getLanguage} from '../assets/i18n.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn,execFile } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { createHash,randomUUID } from 'node:crypto';
import { normalizeSettings,normalizeRig,WEAPONS,WEAPON_KEYS,weaponCatalog } from '../assets/combat.js';
import { fileURLToPath } from 'node:url';
import {resolveTheme} from '../assets/themes.js';

// A separate, transparent Windows window. No Electron installation is patched.
export function createDesktopPet(options={}){
  const runtimeRoot=path.resolve(os.tmpdir());
  let child=null,dir=null,state={},lastError='',queue=Promise.resolve(),opening=null,lastWindow=null;
  let worker=null,pollTimer=null,heartbeatTimer=null,polling=false,inputAck=0,frameWriting=false,mode='pet',transfer=null,notifications=[],notificationId=0,hitId=0;
  let pendingHits=[],damageTimer=null,arenaSnapshot=null,arenaSettings=null,workerReady=null,workerState=null,arenaOpening=null,arenaStopping=null,damageSaving=null;
  const hitSession='desktop:'+randomUUID();
  const sessionKeys=['enabled','speech','gravity','desktopX','desktopY','name','image','bounds','engineState','paintedBodies','fragments','weapon','targetSignature'];
  let desiredOpen=false,desiredMode='pet',sessionTimer=null,closing=false,prefersDark=true,capturing=null,restoringArena=false;
  try{if(options.sessionPath){const saved=JSON.parse(fs.readFileSync(options.sessionPath,'utf8'));if(saved.version===1){desiredOpen=saved.open===true;desiredMode=saved.mode==='arena'?'arena':'pet';for(const key of sessionKeys)if(saved.state?.[key]!==undefined)state[key]=saved.state[key];}}}catch(error){if(error.code!=='ENOENT')lastError=i18nText("desktop_pet.001")+error.message;}
  const config=()=>options.getConfig?.()||{combatSettings:normalizeSettings(),activeTarget:{},stats:{totalDamageDealt:0}};
  const targetSignature=()=>{const t=config().activeTarget;return createHash('sha256').update(JSON.stringify(t?[t.id,t.avatar||'',t.textures||{},normalizeRig(t.rig),t.groups||[],t.bones||[],t.sequences||{}]:null)).digest('hex');};
  if(state.targetSignature&&state.targetSignature!==targetSignature())for(const key of ['image','bounds','engineState','paintedBodies','fragments'])delete state[key];
  if(desiredOpen&&state.engineState)transfer={id:randomUUID(),state:state.engineState};
  function saveSession(){
    if(!options.sessionPath)return;
    if(lastWindow?.mode==='pet'){state.desktopX=lastWindow.left;state.desktopY=lastWindow.top;}
    const saved={version:1,open:desiredOpen,mode:desiredMode,state:Object.fromEntries(sessionKeys.filter(k=>state[k]!==undefined).map(k=>[k,state[k]]))};
    try{fs.mkdirSync(path.dirname(options.sessionPath),{recursive:true});fs.writeFileSync(options.sessionPath+'.tmp',JSON.stringify(saved));fs.renameSync(options.sessionPath+'.tmp',options.sessionPath);}catch(error){lastError=i18nText("desktop_pet.002")+error.message;}
  }
  const notify=action=>{notifications.push({id:++notificationId,action});notifications=notifications.slice(-20);};
  const status=()=>{
    let window=child?lastWindow:null;
    try{if(child&&dir)window=lastWindow=JSON.parse(fs.readFileSync(path.join(dir,'ready.json'),'utf8').replace(/^\uFEFF/,''));}catch{}
    return {supported:process.platform==='win32',running:!!child,desiredOpen,error:lastError,window,
      mode,notifications,transfer,arena:arenaSnapshot,state:{gravity:state.gravity,name:state.name,damage:state.damage,damageError:state.damageError,enabled:state.enabled,speech:state.speech,message:state.message,status:state.status,masked:state.masked,paintedBodies:state.paintedBodies,fragments:state.fragments}};
  };
  async function removeRuntime(old){
    await queue.catch(()=>{});
    if(path.dirname(path.resolve(old))!==runtimeRoot||!path.basename(old).startsWith('fk-desktop-pet-'))throw new Error(i18nText("desktop_pet.003"));
    await fs.promises.rm(old,{recursive:true,force:true,maxRetries:3});
  }
  const persist=()=>{
    if(!dir)return Promise.resolve();const target=path.join(dir,'state.json'),data=JSON.stringify({...Object.fromEntries(Object.entries(state).filter(([key])=>key!=='engineState'&&key!=='settingsSignature')),heartbeat:Date.now()});
    queue=queue.catch(()=>{}).then(async()=>{await fs.promises.writeFile(target+'.tmp',data);for(let attempt=0;;attempt++){try{await fs.promises.rename(target+'.tmp',target);break;}catch(error){if(!['EBUSY','EPERM','EACCES'].includes(error.code)||attempt>=6)throw error;await new Promise(resolve=>setTimeout(resolve,8));}}});return queue;
  };
  async function update(input){
    if(state.languageRevision!==getLanguageRevision()){state.languageRevision=getLanguageRevision();state.language=Object.fromEntries(Object.entries(getCatalogs()[getLanguage()]).filter(([key])=>key.startsWith('native.')||key==='pet.001'));state.weapons=Object.entries(weaponCatalog(config().combatSettings)).map(([id,w],i)=>({id,behavior:w.behavior||id,name:w.name,hint:w.hint,key:WEAPON_KEYS[i]||i18nText("desktop_pet.004")}));worker?.postMessage({type:'language',catalogs:getCatalogs(),locale:getLanguage()});}
    if(typeof input.prefersDark==='boolean')prefersDark=input.prefersDark;
    state.theme=resolveTheme(config().combatSettings?.theme,prefersDark);
    const cfg=config(),latest=normalizeSettings({...cfg.combatSettings,dialogue:cfg.activeTarget?.dialogue||cfg.combatSettings?.dialogue}),signature=JSON.stringify(latest);if(signature!==state.settingsSignature){state.settingsSignature=signature;arenaSettings={...latest,swearWords:latest.swearWords.length?latest.swearWords:arenaSettings?.swearWords||[]};state.weapons=Object.entries(weaponCatalog(latest)).map(([id,w],i)=>({id,behavior:w.behavior||id,name:w.name,hint:w.hint,key:WEAPON_KEYS[i]||i18nText("desktop_pet.004")}));if(!Object.hasOwn(weaponCatalog(latest),state.weapon))state.weapon='fist';worker?.postMessage({type:'settings',settings:desktopSettings()});}
    if(typeof input.enabled==='boolean')state.enabled=input.enabled;
    if(typeof input.gravity==='boolean'&&state.gravity!==input.gravity){state.gravity=input.gravity;worker?.postMessage({type:'settings',settings:desktopSettings()});}
    if(typeof input.name==='string')state.name=input.name.slice(0,80);
    const acceptFrame=mode==='pet'&&(!transfer||input.transferAck===transfer.id);
    if(acceptFrame&&input.bounds&&['x','y','width','height'].every(k=>Number.isFinite(input.bounds[k])&&input.bounds[k]>=0&&input.bounds[k]<=350))state.bounds={...input.bounds};
    if(input.engineState&&acceptFrame){if(JSON.stringify(input.engineState).length>8000000)throw new Error(i18nText("desktop_pet.005"));state.engineState=input.engineState;state.targetSignature=targetSignature();}
    if(Number.isSafeInteger(input.browserAck))notifications=notifications.filter(n=>n.id>input.browserAck);
    if(input.transferAck===transfer?.id)transfer=null;
    if(typeof input.speech==='boolean')state.speech=input.speech;
    for(const key of ['desktopX','desktopY'])if(Number.isFinite(input[key]))state[key]=Math.max(-16000,Math.min(16000,input[key]));
    if(typeof input.hitMessage==='string'&&Number.isFinite(input.hitUntil)){state.hitMessage=input.hitMessage.slice(0,80);state.hitUntil=Math.min(Date.now()+15000,input.hitUntil);}
    if(typeof input.message==='string')state.message=input.message.slice(0,260);
    if(typeof input.status==='string')state.status=input.status.slice(0,24);
    if(typeof input.masked==='boolean')state.masked=input.masked;
    for(const key of ['paintedBodies','fragments'])if(acceptFrame&&Number.isFinite(input[key]))state[key]=input[key];
    if(typeof input.image==='string'&&acceptFrame){
      if(input.image.length>1000000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.image))throw new Error(i18nText("desktop_pet.006"));
      state.image=input.image;
    }
    await persist();return status();
  }
  async function start(){
    if(process.platform!=='win32')throw new Error(i18nText("desktop_pet.007"));
    if(child){await persist();return status();}
    state.language=Object.fromEntries(Object.entries(getCatalogs()[getLanguage()]).filter(([key])=>key.startsWith('native.')||key==='pet.001'));state.languageRevision=getLanguageRevision();
    const cfg=config();state.gravity??=cfg.combatSettings?.pet?.gravity!==false;state.name=cfg.activeTarget?.name||state.name||i18nText("pet.001");state.damage=cfg.stats?.totalDamageDealt||0;state.weapon||='fist';state.mode='pet';state.weapons=Object.entries(weaponCatalog(cfg.combatSettings)).map(([id,w],i)=>({id,behavior:w.behavior||id,name:w.name,hint:w.hint,key:WEAPON_KEYS[i]||i18nText("desktop_pet.004")}));
    if(cfg.combatSettings?.theme?.mode==='system')prefersDark=await new Promise(resolve=>execFile('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize','/v','AppsUseLightTheme'],{windowsHide:true,timeout:2000},(_err,stdout)=>resolve(!/AppsUseLightTheme\s+REG_DWORD\s+0x1\b/i.test(stdout||''))));
    state.theme=resolveTheme(cfg.combatSettings?.theme,prefersDark);
    inputAck=0;state.inputAck=0;state.pipeName='fk-desktop-arena-'+randomUUID();dir??=fs.mkdtempSync(path.join(runtimeRoot,'fk-desktop-pet-'));state.enabled??=cfg.combatSettings?.pet?.enabled!==false;await persist();lastError='';lastWindow=null;
    await fs.promises.rm(path.join(dir,'ready.json'),{force:true});
    const script=fileURLToPath(new URL('./desktop-pet.ps1',import.meta.url));
    child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',script,'-StatePath',path.join(dir,'state.json'),'-HostProcessId',String(options.hostPid||0),'-HostWindowTitle',options.hostTitle||''],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    const current=child;let errors='';current.stderr.setEncoding('utf8');current.stderr.on('data',data=>errors=(errors+data).slice(-2000));
    const ended=()=>{if(child!==current)return;status();if(lastWindow?.closedByUser)desiredOpen=false;clearInterval(pollTimer);clearInterval(heartbeatTimer);clearInterval(sessionTimer);stopArena().then(saveSession).catch(()=>{});saveSession();child=null;const old=dir;dir=null;if(old)removeRuntime(old).catch(e=>{lastError=e.message;});};
    current.on('error',e=>{lastError=e.message;ended();});
    current.on('exit',code=>{if(errors.trim()||code)lastError=errors||i18nText("desktop_pet.008", {v0: code});ended();});
    clearInterval(pollTimer);pollTimer=setInterval(readNative,20);clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>persist().catch(e=>{lastError=e.message;}),5000);
    clearInterval(sessionTimer);sessionTimer=setInterval(()=>{checkpoint().catch(e=>{lastError=e.message;});},3000);
    // Wait for WPF startup rather than reporting success for a failed child.
    for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));if(!child)throw new Error(lastError||i18nText("desktop_pet.009"));const ready=status();if(ready.window)return ready;}
    await close({waitOpen:false});throw new Error(i18nText("desktop_pet.010"));
  }
  function open(){desiredOpen=true;state.enabled=true;saveSession();return opening??=(start().finally(()=>{opening=null;}));}
  async function restore(){if(process.platform!=='win32'||!desiredOpen)return status();const savedMode=desiredMode;await (opening??=(start().finally(()=>{opening=null;})));if(savedMode==='arena'){restoringArena=true;try{await startArena();}finally{restoringArena=false;}}return status();}
  async function close({remember=true,waitOpen=true}={}){
    closing=true;if(waitOpen&&opening)await opening.catch(()=>{});status();const savedMode=mode;
    if(remember)desiredOpen=false;else desiredMode=savedMode;
    await stopArena();if(!remember)desiredMode=savedMode;clearInterval(pollTimer);clearInterval(heartbeatTimer);clearInterval(sessionTimer);saveSession();
    const current=child;child=null;
    if(current){
      state.quit=true;await persist();
      await new Promise(resolve=>{const timer=setTimeout(()=>{current.kill();resolve();},1500);current.once('exit',()=>{clearTimeout(timer);resolve();});});
      delete state.quit;
    }
    if(dir){const old=dir;dir=null;await removeRuntime(old);}
    closing=false;return status();
  }
  function desktopSettings(){const settings=arenaSettings||normalizeSettings(config().combatSettings);return {...settings,gravity:state.gravity===false?0:settings.gravity};}
  function flushDamage(){return damageSaving??=(saveDamage().finally(()=>{damageSaving=null;}));}
  async function saveDamage(){
    clearTimeout(damageTimer);damageTimer=null;if(!pendingHits.length)return;
    const batch=pendingHits.slice(0,256);
    try {const stats=await options.recordHits?.(batch);pendingHits.splice(0,batch.length);state.damage=(stats?.totalDamageDealt??state.damage??0)+pendingHits.reduce((n,h)=>n+h.damage,0);state.damageError='';}
    catch(error){state.damageError=i18nText("desktop_pet.011")+error.message;}
    if(pendingHits.length)damageTimer=setTimeout(()=>flushDamage().catch(e=>{lastError=e.message;}),500);await persist();
  }
  function builtinAudio(weapon,event){
    const rate=16000,duration=event==='charge'?.3:weapon==='hammer'?.2:.12,count=Math.round(rate*duration),out=Buffer.alloc(44+count*2);
    out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(count*2,40);
    const index=Object.keys(WEAPONS).indexOf(weapon),f=event==='charge'?400:90+index*32;
    for(let i=0;i<count;i++){const t=i/rate,envelope=Math.exp(-t/(duration*.23)),noise=(Math.random()-.5)*(index>=8?.9:.35),tone=Math.sin(2*Math.PI*f*t*(1-t/duration*.7));out.writeInt16LE(Math.round(Math.max(-1,Math.min(1,(tone*.5+noise)*envelope)) * 20000),44+i*2);}return out;
  }
  async function audioEvents(sounds){
    for(const sound of sounds||[]){
      const source=sound.source;let bytes,ext='wav';
      if(source){const match=/^data:audio\/(mpeg|mp3|x-wav|wave|wav|ogg|webm|mp4|aac|flac);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(source);if(!match)continue;ext=({mpeg:'mp3','x-wav':'wav',wave:'wav'})[match[1]]||match[1];bytes=Buffer.from(match[2],'base64');}
      const key=source?createHash('sha256').update(source).digest('hex').slice(0,20):sound.weapon+'-'+sound.event;
      const file='sound-'+key+'.'+ext,target=path.join(dir,file);
      if(!fs.existsSync(target))await fs.promises.writeFile(target,bytes||builtinAudio(sound.weapon,sound.event));
      state.sounds??=[];state.soundId=(state.soundId||0)+1;state.sounds.push({id:state.soundId,file,volume:Math.min(1,desktopSettings().volume*(sound.volume??1)*(.65+sound.strength*.2)),pitch:sound.pitch??1});state.sounds=state.sounds.slice(-24);
    }
  }
  function startArena(){return arenaOpening??=(launchArena().finally(()=>{arenaOpening=null;}));}
  async function launchArena(){
    if(arenaStopping)await arenaStopping;
    if(worker)return status();if(!child)await open();
    const cfg=config();arenaSettings=normalizeSettings({...cfg.combatSettings,dialogue:cfg.activeTarget?.dialogue||cfg.combatSettings?.dialogue});if(options.getSwearWords)arenaSettings.swearWords=await options.getSwearWords();
    const screen=lastWindow?.screen||{left:0,top:0,width:1280,height:720};
    const width=Math.max(320,Math.min(8000,screen.width)),height=Math.max(240,Math.min(4500,screen.height));
    const anchor=restoringArena?null:{x:Math.max(80,Math.min(width-80,(lastWindow?.left||0)+150-screen.left)),y:Math.max(130,Math.min(height-110,(lastWindow?.top||0)+210-screen.top))};
    worker=new Worker(new URL('./desktop-arena-worker.js',import.meta.url),{execArgv:[]});
    const current=worker;current.postMessage({type:'language',catalogs:getCatalogs(),locale:getLanguage()});
    const ready=new Promise((resolve,reject)=>{workerReady={resolve,reject};});
    mode='arena';desiredMode='arena';saveSession();
    current.on('message',message=>{(async()=>{
      if(current!==worker)return;
      if(message.type==='ready'){mode='arena';state.mode='arena';state.screen=screen;await persist();workerReady?.resolve();workerReady=null;}
      else if(message.type==='error'){lastError=message.error;if(workerReady)workerReady.reject(new Error(message.error));else stopArena().catch(()=>{});workerReady=null;}
      else if(message.type==='hit'){pendingHits.push({...message.hit,id:hitSession+':'+(++hitId)});state.damage=(state.damage||0)+message.hit.damage;if(!damageTimer)damageTimer=setTimeout(()=>flushDamage().catch(e=>{lastError=e.message;}),200);}
      else if(message.type==='state'){workerState?.(message);workerState=null;}
      else if(message.type==='telemetry'&&dir){
        arenaSnapshot=message.snapshot;if(message.sounds.length){await audioEvents(message.sounds);await persist();}
      }
    })().catch(error=>{lastError=error.message;workerReady?.reject(error);workerReady=null;stopArena().catch(()=>{});});});
    current.on('error',error=>{lastError=error.message;workerReady?.reject(error);workerReady=null;stopArena().catch(()=>{});});
    state.damage=(cfg.stats?.totalDamageDealt||0)+pendingHits.reduce((n,h)=>n+h.damage,0);
    current.postMessage({type:'start',preset:cfg.activeTarget,settings:desktopSettings(),state:state.engineState,width,height,anchor,weapon:state.weapon||'fist',agentSources:cfg.agentSources,customWords:cfg.customWords,pipeName:state.pipeName,pixelRatio:lastWindow?.scaleX||1});
    try{await Promise.race([ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error(i18nText("desktop_pet.012"))),10000);timer.unref();})]);}catch(error){await stopArena();throw error;}
    return status();
  }
  function stopArena(){return arenaStopping??=(finishArena().finally(()=>{arenaStopping=null;}));}
  function captureState(){if(!worker)return Promise.resolve(null);return capturing??=(new Promise(resolve=>{const timer=setTimeout(()=>{workerState=null;resolve(null);},1500);workerState=data=>{clearTimeout(timer);resolve(data);};worker.postMessage({type:'state'});}).finally(()=>{capturing=null;}));}
  async function checkpoint(){
    if(worker&&!closing){const saved=await captureState();if(saved){state.engineState=saved.state;state.image=saved.pet.image;state.bounds=saved.pet.bounds;state.paintedBodies=saved.pet.paintedBodies;state.fragments=saved.pet.fragments;}}
    saveSession();
  }
  async function finishArena(){
    if(!worker)return status();const current=worker;
    const saved=await captureState();
    if(saved){const id=randomUUID();transfer={id,state:saved.state};state.engineState=saved.state;state.image=saved.pet.image;state.bounds=saved.pet.bounds;state.paintedBodies=saved.pet.paintedBodies;state.fragments=saved.pet.fragments;if(saved.state.dialogue?.remaining>0){state.hitMessage=saved.state.dialogue.text;state.hitUntil=Date.now()+saved.state.dialogue.remaining*1000;}const bs=saved.state.bodies;if(bs.length)state.returnPosition={x:(state.screen?.left||0)+bs.reduce((n,b)=>n+b.x,0)/bs.length-150,y:(state.screen?.top||0)+bs.reduce((n,b)=>n+b.y,0)/bs.length-210};}
    worker=null;workerState=null;current.postMessage({type:'stop'});await current.terminate();
    mode='pet';if(!closing)desiredMode='pet';state.mode='pet';arenaSnapshot=null;state.sounds=[];await flushDamage();await persist();saveSession();return status();
  }
  async function readNative(){
    if(polling||!dir||!child)return;polling=true;
    try{
      const data=JSON.parse((await fs.promises.readFile(path.join(dir,'ready.json'),'utf8')).replace(/^\uFEFF/,''));lastWindow=data;
      for(const command of data.commands||[]){
        if(!Number.isSafeInteger(command.id)||command.id<=inputAck)continue;
        inputAck=command.id;state.inputAck=inputAck;
        if(command.action==='startArena')await startArena();
        else if(command.action==='stopArena')await stopArena();
        else if(['openArena','openStats'].includes(command.action)){await stopArena();notify(command.action);}
        else if(command.action==='gravity'){state.gravity=!!command.value;options.onGravity?.(state.gravity);worker?.postMessage({type:'settings',settings:desktopSettings()});}
        else if(command.action==='weapon'&&Object.hasOwn(weaponCatalog(config().combatSettings),command.weapon)){state.weapon=command.weapon;worker?.postMessage({type:'weapon',weapon:command.weapon});}
        else if(command.action==='reset')worker?.postMessage({type:'reset'});
        else if(['down','up','move','cancel','teleport'].includes(command.action)&&Number.isFinite(command.x)&&Number.isFinite(command.y))worker?.postMessage({type:'input',event:{type:command.action,x:command.x,y:command.y}});
      }
      if((data.commands||[]).some(c=>c.id<=inputAck))await persist();
    }catch(error){if(!['ENOENT','EBUSY','EPERM','EACCES'].includes(error.code)&&!(error instanceof SyntaxError))lastError=error.message;}finally{polling=false;}
  }
  function snapshotSession(){if(!options.sessionPath||(!child&&!desiredOpen&&!fs.existsSync(options.sessionPath)))return;status();if(!closing)desiredMode=mode;saveSession();}
  return {status,open,update,close,restore,startArena,stopArena,snapshotSession};
}
