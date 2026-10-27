import {setLanguage} from '../assets/i18n.js';
import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createCanvas, loadImage, Image, GlobalFonts } from '@napi-rs/canvas';
import { createCombat } from '../assets/combat.js';
import { scanMultiAgentSessions } from './scanner.js';
import net from 'node:net';
import fs from 'node:fs';
// Explicit aliases avoid Skia resolving system-ui to a Latin-only face.
for(const [file,family] of [['msyh.ttc','Microsoft YaHei'],['msyhbd.ttc','Microsoft YaHei'],['simhei.ttf','SimHei']]){const path=(process.env.WINDIR||'C:/Windows')+'/Fonts/'+file;if(fs.existsSync(path))GlobalFonts.registerFromPath(path,family);}

const noop=()=>{},events={addEventListener:noop,removeEventListener:noop};
let frameDeadline=0;
const platform={window:{...events,matchMedia:()=>({...events,matches:true}),devicePixelRatio:1},
  document:{...events,hidden:false,createElement:()=>canvas(1,1)},Image,loadImage,
  ResizeObserver:class {observe(){}disconnect(){}},
  requestAnimationFrame:callback=>{const now=performance.now();frameDeadline=Math.max(now,frameDeadline+1000/60);return setTimeout(()=>callback(performance.now()),Math.max(0,frameDeadline-now));},cancelAnimationFrame:clearTimeout};
function canvas(w,h){const c=createCanvas(w,h);Object.assign(c,events,{getBoundingClientRect:()=>({left:0,top:0,width:c.width,height:c.height})});return c;}
let engine=null,stage=null,frameTimer=null,closed=false,sounds=[],socket=null,blocked=false,sequence=0,lastSample=0,frames=0,sampleFrames=0,sampleTime=0,renderFps=0,publishMs=0;
const send=(type,value)=>parentPort.postMessage({type,...value});
async function connectPipe(pipeName){
  for(let i=0;i<100;i++){
    try{return await new Promise((resolve,reject)=>{const stream=net.createConnection('\\\\.\\pipe\\'+pipeName);stream.once('connect',()=>{stream.removeListener('error',reject);stream.on('error',error=>{if(!closed)send('error',{error:error.message});});stream.on('drain',()=>{blocked=false;});resolve(stream);});stream.once('error',reject);});}
    catch(error){if(i===99)throw error;await new Promise(resolve=>setTimeout(resolve,30));}
  }
}
function pixels(){
  if(!engine||closed)return;
  const now=performance.now();frames++;
  if(now-sampleTime>=1000){renderFps=(frames-sampleFrames)*1000/(now-sampleTime);sampleFrames=frames;sampleTime=now;}
  const b=engine.contentBounds(),regions=engine.contentBounds(true);
  if(!blocked){
    const started=performance.now();
    if(socket){
      const size=regions.reduce((n,r)=>n+16+r.width*r.height*4,0),packet=Buffer.allocUnsafe(24+size);let offset=24;
      [0x464B5032,stage.width,stage.height,regions.length,++sequence,size].forEach((v,i)=>packet.writeInt32LE(v,i*4));
      for(const r of regions){[r.x,r.y,r.width,r.height].forEach((v,i)=>packet.writeInt32LE(v,offset+i*4));offset+=16;const rgba=stage.getContext('2d').getImageData(r.x,r.y,r.width,r.height).data,src=new Uint32Array(rgba.buffer,rgba.byteOffset,rgba.byteLength/4),dst=new Uint32Array(packet.buffer,packet.byteOffset+offset,src.length);
        for(let i=0;i<src.length;i++){const v=src[i],a=v>>>24;if(a===255)dst[i]=(v&0xff00ff00)|((v&255)<<16)|((v>>>16)&255);else if(a===0)dst[i]=0;else dst[i]=(a<<24)|(((v&255)*a/255|0)<<16)|((((v>>>8)&255)*a/255|0)<<8)|(((v>>>16)&255)*a/255|0);}offset+=rgba.length;}
      blocked=!socket.write(packet);
    }else {const rgba=stage.getContext('2d').getImageData(b.x,b.y,b.width,b.height).data;for(let i=0;i<rgba.length;i+=4){const r=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=r;}send('frame',{data:Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength),width:stage.width,height:stage.height,bounds:b,format:'bgra'});}
    publishMs=performance.now()-started;
  }
  if(now-lastSample>=100||sounds.length){lastSample=now;send('telemetry',{sounds:sounds.splice(0),snapshot:{...engine.snapshot(),render:{width:stage.width,height:stage.height,fps:renderFps,publishMs,region:b,tiles:regions.length,pixelArea:regions.reduce((n,r)=>n+r.width*r.height,0),transport:socket?'pipe-bgra':'bgra',blocked,bytesWritten:socket?.bytesWritten,queued:socket?.writableLength}}});}
}
async function setup({preset,settings,state,width,height,anchor,weapon,agentSources,customWords,pipeName,pixelRatio=1}){
  engine?.dispose();clearInterval(frameTimer);
  if(!settings.swearWords?.length&&agentSources?.length)settings.swearWords=scanMultiAgentSessions(agentSources,customWords).rank||[];
  platform.window.devicePixelRatio=Math.max(1,Math.min(4,pixelRatio));
  stage=canvas(width,height);stage.getBoundingClientRect=()=>({left:0,top:0,width,height});
  if(pipeName)socket=await connectPipe(pipeName);
  engine=createCombat(stage,{platform,settings,onFrame:pixels,onHit:hit=>send('hit',{hit}),onSound:sound=>{if(sounds.length<24)sounds.push(sound);}});
  const skins={},sequences={};
  if(preset){
    await Promise.all(Object.entries(preset.textures||{}).map(async([id,src])=>{skins[id]=await loadImage(src);}));
    await Promise.all(Object.entries(preset.sequences||{}).map(async([id,s])=>{sequences[id]={fps:s.fps,frames:await Promise.all(s.frames.map(src=>loadImage(src)))};}));
    engine.setRig(preset.rig);engine.setTarget(preset.avatar?await loadImage(preset.avatar):null,skins,sequences);engine.setDialogueOwner(preset.id);
  }
  engine.setSurface({width,height,transparent:true,tether:false});engine.reset();
  if(state)await engine.importState(state,anchor);
  engine.setTargetEnabled(!!preset);engine.selectWeapon(weapon||'fist');engine.setActive(true);
  send('ready',{});
}
parentPort.on('message',async message=>{
  try{
    if(message.type==='language')setLanguage(message.catalogs,message.locale);
    else if(message.type==='start')await setup(message);
    else if(message.type==='input')engine?.input(message.event);
    else if(message.type==='weapon')engine?.selectWeapon(message.weapon);
    else if(message.type==='reset')engine?.reset();
    else if(message.type==='settings')engine?.updateSettings(message.settings);
    else if(message.type==='state')send('state',{state:engine.exportState(),pet:engine.petFrame()});
    else if(message.type==='stop'){closed=true;clearInterval(frameTimer);engine?.dispose();socket?.destroy();parentPort.close();}
  }catch(error){send('error',{error:error.stack||error.message});}
});
