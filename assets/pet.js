import {t as i18nText} from './i18n.js';
// Browser model snapshots feed native windows; desktop combat runs in a worker.
export function createPet(root,options={}) {
  let {desktopX,desktopY,gravity=true}=options.settings||{};
  let enabled=options.settings?.enabled!==false,speech=options.settings?.speech!==false,running=false,sending=false,polling=false,disposed=false;
  let hitMessage='',hitUntil=0;
  let supported=true,prefersDark=matchMedia('(prefers-color-scheme: dark)').matches,targetId='';
  let lastMessage='',lastStatus='idle',hostBusy=false,scanTimer=0,sequence=0,name=i18nText("pet.001"),mode='pet',browserAck=0,transferAck=null,gravityDirty=true,handling=Promise.resolve();
  const report=message=>options.onStatus?.(message);
  const request=async(action,input)=>{
    const response=await fetch('/fk-the-ai/api/pet/'+action,{method:action==='status'?'GET':'POST',headers:{'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||i18nText("pet.002"));return data;
  };
  function handle(data){
    handling=handling.catch(()=>{}).then(async()=>{
      running=data.running;
      supported=data.supported!==false;options.onSupport?.(supported);
      if(data.transfer&&data.transfer.id!==transferAck&&options.isReady?.()!==false){await options.onTransfer?.(data.transfer.state);transferAck=data.transfer.id;}
      const next=data.mode||'pet';if(next!==mode){mode=next;options.onMode?.(mode);}
      if(!gravityDirty&&typeof data.state?.gravity==='boolean'&&data.state.gravity!==gravity){gravity=data.state.gravity;options.onGravity?.(gravity);}
      if(typeof data.state?.damage==='number')options.onDamage?.(data.state.damage);
      if(mode==='pet'&&data.window&&!data.window.dragging&&Math.abs(data.window.vy)<25){
        const x=Math.round(data.window.left),y=Math.round(data.window.top);if(x!==desktopX||y!==desktopY){desktopX=x;desktopY=y;options.onMove?.(x,y);}
      }
      for(const notification of data.notifications||[]){if(notification.id<=browserAck)continue;browserAck=notification.id;options.onNavigate?.(notification.action==='openStats'?'stats':'arena');}
      if(!supported)report(i18nText("pet.003"));else if(data.error)report(data.error);else if(!running)report(i18nText("pet.004"));
    });return handling;
  }
  async function sync(forceState=false){
    if(!running||!supported||sending||disposed||options.isReady?.()===false)return;sending=true;
    const dirty=gravityDirty,gravitySent=gravity;
    try{
      const data=await request('state',{...(enabled&&mode==='pet'?options.getFrame?.():{}),
        ...(mode==='pet'&&(forceState||sequence%5===0)?{engineState:options.getState?.()}:{}),
        enabled,speech,desktopX,desktopY,name,prefersDark,status:lastStatus,message:lastMessage,hitMessage,hitUntil,browserAck,transferAck,...(dirty?{gravity:gravitySent}:{})});
      if(dirty&&gravity===gravitySent)gravityDirty=false;await handle(data);
    }catch(error){report(error.message);}finally{sending=false;}
  }
  const speak=text=>{if(typeof text==='string'){lastMessage=text.slice(0,260);sync();}};
  function taskStatus(status,message=''){
    if(!['running','completed','error','idle'].includes(status))return;
    if(status!==lastStatus||message){lastStatus=status;speak(message||{running:i18nText("pet.005"),completed:i18nText("pet.006"),error:i18nText("pet.007"),idle:i18nText("pet.008")}[status]);}
  }
  const taskEvent=e=>{if(e.detail&&typeof e.detail==='object')taskStatus(e.detail.status,typeof e.detail.message==='string'?e.detail.message:'');};
  window.addEventListener('fk-the-ai:task',taskEvent);
  function scanHost(){
    scanTimer=0;if(!enabled)return;
    const outside=node=>!node.closest('.fk-ai-modal-overlay,.fk-ai-widget');
    const busy=[...root.querySelectorAll('[data-chat-running],[aria-busy="true"],[data-task-status="running"],button[aria-label="Stop generating"],button[aria-label="停止生成"]')].some(node=>outside(node)&&node.getClientRects().length);
    if(busy!==hostBusy){hostBusy=busy;taskStatus(busy?'running':'completed');}
    const latest=[...root.querySelectorAll('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]),[data-message-author-role="assistant"],[data-testid="assistant-message"],.assistant-message')].filter(outside).at(-1)?.cloneNode(true);
    latest?.querySelectorAll('[data-turn-process-inline],[data-variant="think"],button').forEach(node=>node.remove());
    const text=latest?.textContent?.trim();if(text&&text!==lastMessage)speak(text);
  }
  const observer=new MutationObserver(records=>{if(!enabled||records.every(r=>(r.target instanceof Element?r.target:r.target.parentElement)?.closest('.fk-ai-modal-overlay,.fk-ai-widget')))return;if(!scanTimer)scanTimer=setTimeout(scanHost,500);});
  observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-busy','aria-label','data-task-status','data-chat-running']});
  async function poll(){if(polling||disposed)return;polling=true;try{await handle(await request('status'));}catch(error){report(error.message);}finally{polling=false;}}
  const timer=setInterval(()=>{sequence++;sync();},200),statusTimer=setInterval(poll,750);poll();
  async function open(){
    try{
      await request('state',{...options.getFrame?.(),engineState:options.getState?.(),enabled:true,speech,gravity,desktopX,desktopY,name,status:lastStatus,message:lastMessage});
      await handle(await request('open'));enabled=true;report(i18nText("pet.009"));return true;
    }catch(error){report(error.message);return false;}
  }
  return {
    open,speak,updateTheme(value){prefersDark=value;sync();},hitSpeech(text,duration=3){hitMessage=String(text).slice(0,80);hitUntil=Date.now()+duration*1000;sync();},
    async startArena(){try{await options.onBeforeArena?.();if(!running&&!(await open()))return false;await sync(true);await handle(await request('arena'));return true;}catch(error){report(error.message);options.onMode?.('pet');return false;}},
    async stopArena(){try{await handle(await request('exit-arena'));return true;}catch(error){report(error.message);return false;}},
    update(value={}){
      if(Number.isFinite(value.desktopX))desktopX=value.desktopX;if(Number.isFinite(value.desktopY))desktopY=value.desktopY;
      if(typeof value.gravity==='boolean'&&value.gravity!==gravity){gravity=value.gravity;gravityDirty=true;}
      if(typeof value.enabled==='boolean')enabled=value.enabled;if(typeof value.speech==='boolean')speech=value.speech;sync();
    },
    setTarget(value){if(targetId!==(value?.id||'')){targetId=value?.id||'';hitMessage='';hitUntil=0;}name=value?.name||i18nText("pet.001");sync(true);},
    dispose(){disposed=true;clearInterval(timer);clearInterval(statusTimer);clearTimeout(scanTimer);observer.disconnect();window.removeEventListener('fk-the-ai:task',taskEvent);}
  };
}
