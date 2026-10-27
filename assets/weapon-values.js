import {NODE_TYPES,GRAPH_LIMITS} from './weapon-graph.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const rgbaHex=(r,g,b,a=1)=>'#'+[r,g,b,clamp(a,0,1)*255].map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');

// Data nodes are evaluated on demand for each node execution. Shared inputs use
// one sample within that execution; a later hit/emission gets a fresh sample.
export function createValueResolver(random=Math.random){
 const variables=new Map();
 function resolve(program,node,event,context){
  const cache=new Map();let budget=GRAPH_LIMITS.events;
  function params(n,depth){
   const result={...n.params};for(const link of program.inputs.get(n.id)||[]){const f=NODE_TYPES[n.type].fields[link.param],v=value(link.from,depth+1);
    if(f.kind==='number'&&typeof v==='number'&&Number.isFinite(v))result[link.param]=clamp(['count','pierce','bounce','repeat'].includes(link.param)?Math.round(v):v,f.min,f.max);
    else if(f.kind==='color'&&typeof v==='string'&&/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(v))result[link.param]=v;
    else if(f.kind==='select'&&Object.hasOwn(f.options,v))result[link.param]=v;
    else if(f.kind==='text'&&typeof v==='string')result[link.param]=v.slice(0,f.max);
   }return result;
  }
  const sample=(a,b)=>Math.min(a,b)+random()*Math.abs(b-a);
  function value(id,depth){
   if(cache.has(id))return cache.get(id);if(depth>GRAPH_LIMITS.depth||--budget<0)return 0;
   const n=program.nodes.get(id);if(!n||!NODE_TYPES[n.type].data)return 0;const p=params(n,depth);let v=0;
   if(n.type==='number'||n.type==='text')v=p.value;
   if(n.type==='random'){const low=Math.ceil(Math.min(p.min,p.max)),high=Math.floor(Math.max(p.min,p.max));v=p.integer==='integer'?(high>=low?Math.floor(sample(low,high+1)):Math.round(sample(p.min,p.max))):sample(p.min,p.max);}
   if(n.type==='color')v=rgbaHex(p.r,p.g,p.b,p.a);
   if(n.type==='randomColor')v=rgbaHex(sample(p.rMin,p.rMax),sample(p.gMin,p.gMax),sample(p.bMin,p.bMax),sample(p.aMin,p.aMax));
   if(n.type==='math')v=({add:()=>p.a+p.b,subtract:()=>p.a-p.b,multiply:()=>p.a*p.b,divide:()=>p.b?p.a/p.b:0,mod:()=>p.b?p.a%p.b:0,power:()=>Math.pow(p.a,p.b),min:()=>Math.min(p.a,p.b),max:()=>Math.max(p.a,p.b),sin:()=>Math.sin(p.a),cos:()=>Math.cos(p.a),abs:()=>Math.abs(p.a),floor:()=>Math.floor(p.a),round:()=>Math.round(p.a)})[p.op]();
   if(n.type==='compare')v=Number(({gt:p.a>p.b,gte:p.a>=p.b,lt:p.a<p.b,lte:p.a<=p.b,eq:p.a===p.b})[p.op]);
   if(n.type==='select')v=p.condition>0?p.yes:p.no;
   if(n.type==='variable')v=({stored:()=>variables.get(program.id)?.get(p.name)??p.initial,time:()=>context.time,charge:()=>event.charge||0,speed:()=>event.speed||0,pointerX:()=>context.pointer.x,pointerY:()=>context.pointer.y,targetX:()=>event.target?.x||0,targetY:()=>event.target?.y||0,targetVX:()=>event.target?.vx||0,targetVY:()=>event.target?.vy||0})[p.source]();
   if(typeof v==='number')v=Number.isFinite(v)?clamp(v,-1000000,1000000):0;cache.set(id,v);return v;
  }
  return params(node,0);
 }
 return {resolve,write(id,p){if(!variables.has(id))variables.set(id,new Map());const vars=variables.get(id),old=vars.get(p.name)||0;if(!vars.has(p.name)&&vars.size>=128)return;vars.set(p.name,clamp(p.operation==='add'?old+p.value:p.operation==='multiply'?old*p.value:p.value,-1000000,1000000));},clear(){variables.clear();}};
}
