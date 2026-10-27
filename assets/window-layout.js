import {bindAttribute,t as i18nText} from './i18n.js';
// View preferences belong to this browser, independently of shared combat settings.
export function attachWindowResize(modal) {
 const key='fk-ai-window-size-v1';let size={width:1160,height:780};
 try{const saved=JSON.parse(localStorage.getItem(key));if(Number.isFinite(saved?.width)&&Number.isFinite(saved?.height))size=saved;}catch{}
 function apply(){modal.style.width=Math.min(Math.max(480,size.width),innerWidth*.98)+'px';modal.style.height=Math.min(Math.max(360,size.height),innerHeight*.96)+'px';modal.style.maxWidth='98vw';modal.style.maxHeight='96vh';}
 const save=()=>{try{localStorage.setItem(key,JSON.stringify(size));}catch{}};
 for(const direction of ['n','e','s','w','ne','nw','se','sw']){
  const handle=document.createElement('div');handle.className='fk-window-resize fk-resize-'+direction;handle.dataset.resize=direction;bindAttribute(handle,"aria-label",()=>i18nText("window_layout.001")+direction);modal.append(handle);
  handle.addEventListener('pointerdown',event=>{
   if(event.button!==0)return;event.preventDefault();event.stopPropagation();const rect=modal.getBoundingClientRect(),start={x:event.clientX,y:event.clientY,w:rect.width,h:rect.height};handle.setPointerCapture(event.pointerId);modal.classList.add('fk-resizing');
   const move=e=>{size={width:Math.max(480,Math.min(innerWidth*.98,start.w+(direction.includes('e')?2:direction.includes('w')?-2:0)*(e.clientX-start.x))),height:Math.max(360,Math.min(innerHeight*.96,start.h+(direction.includes('s')?2:direction.includes('n')?-2:0)*(e.clientY-start.y)))};apply();};
   const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);modal.classList.remove('fk-resizing');save();};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  });
 }apply();window.addEventListener('resize',apply);
}
