import {bindAttribute,t as i18nText,bindText} from './i18n.js';
// Deterministic central packing: largest word is anchored exactly at the center.
export function createWordCloud(root){
  let rank=[],timer;
  const colors=['#db5575','#668cdb','#b89948','#48a597','#a27ac4','#dc8851','#798d65'];
  const measure=document.createElement('canvas').getContext('2d');
  function layout(){
    const width=root.clientWidth,height=Math.max(280,Math.min(480,width*.53));if(!width)return;
    root.style.height=height+'px';root.replaceChildren();
    if(!rank.length){bindText(root,()=>i18nText("word_cloud.001"), "textContent");return;}
    const max=rank[0].count,total=rank.reduce((n,r)=>n+r.count,0),placed=[];
    for(const [index,r] of rank.slice(0,240).entries()){
      let size=Math.max(13,Math.min(94,width*.12)*Math.pow(r.count/max,.53)),box=null,vertical=index>5&&index%7===0;
      const font=s=>`900 ${s}px system-ui`;
      // Shrinking less frequent entries makes the cloud dense without overlapping words.
      for(let attempt=0;attempt<5&&!box;attempt++){
        measure.font=font(size);let tw=measure.measureText(r.word).width+6,th=size*1.12+4;
        if(tw>width*.85){size*=width*.85/tw;measure.font=font(size);tw=measure.measureText(r.word).width+6;th=size*1.12+4;}
        const bw=vertical?th:tw,bh=vertical?tw:th;
        for(let step=0;step<(index?24000:1);step++){
          const a=step*.19,rad=2*Math.sqrt(step),x=width/2+Math.cos(a)*rad*1.65,y=height/2+Math.sin(a)*rad;
          const b={x:x-bw/2,y:y-bh/2,w:bw,h:bh,size,vertical};
          if([[b.x,b.y],[b.x+bw,b.y],[b.x,b.y+bh],[b.x+bw,b.y+bh]].some(([x,y])=>((x-width/2)/(width/2-5))**2+((y-height/2)/(height/2-5))**2>1))continue;
          if(placed.some(p=>b.x<p.x+p.w&&b.x+b.w>p.x&&b.y<p.y+p.h&&b.y+b.h>p.y))continue;
          box=b;break;
        }
        if(!box)size*=.85;
      }
      if(!box)continue;placed.push(box);
      const node=document.createElement('span');node.className='fk-ai-word-cloud-item';node.dataset.i18nSkip='';node.textContent=r.word;bindText(node,()=>i18nText("word_cloud.002", {v0: r.word, v1: r.count, v2: (r.count/total*100).toFixed(1)}), "title");node.dataset.count=r.count;
      node.style.cssText=`left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;font-size:${box.size}px;color:${colors[index%colors.length]};`;
      if(box.vertical)node.style.writingMode='vertical-rl';root.append(node);
    }
    root.dataset.shown=placed.length;bindAttribute(root,"aria-label",()=>i18nText("word_cloud.003", {v0: rank.length, v1: placed.length}));
  }
  const observer=new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(layout,60);});observer.observe(root);
  return {update(value){rank=[...value].filter(x=>x.count>0).sort((a,b)=>b.count-a.count);layout();},dispose(){clearTimeout(timer);observer.disconnect();}};
}
