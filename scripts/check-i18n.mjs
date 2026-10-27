import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';
import {parseDocument} from 'yaml';
const root=path.resolve(import.meta.dirname,'..'),failures=[];
function resource(name){const document=parseDocument(fs.readFileSync(path.join(root,'lang',name+'.yml'),'utf8'),{uniqueKeys:true});if(document.errors.length)throw document.errors[0];const data=document.toJS();if(!data||Array.isArray(data)||Object.values(data).some(value=>typeof value!=='string'))throw new Error('Language resources must be flat string mappings');return data;}
const zh=resource('zh_CN'),en=resource('en');
const placeholders=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort().join(',');
for(const key of new Set([...Object.keys(zh),...Object.keys(en)])){
 if(!Object.hasOwn(zh,key)||!Object.hasOwn(en,key))failures.push('Missing translation: '+key);
 else if(placeholders(zh[key])!==placeholders(en[key]))failures.push('Placeholder mismatch: '+key);
}
function inspect(file){
 const source=fs.readFileSync(file,'utf8'),name=path.relative(root,file),ast=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true});
 function error(node,text){failures.push(name+':'+node.loc.start.line+' '+text);}
 function walk(node,parent){
  if(node.type==='Literal'&&typeof node.value==='string'&&/[\u3400-\u9fff]/.test(node.value)){
   const dataWord=name.endsWith('lexicon.js')&&parent?.type==='Property'&&(parent.key.name||parent.key.value)==='word';
   const hostSelector=name.endsWith('pet.js')&&node.value.includes('button[aria-label="Stop generating"]');
   if(!dataWord&&!hostSelector)error(node,'Hardcoded Chinese copy; use lang/*.yml');
  }
  if(node.type==='TemplateElement'&&/[\u3400-\u9fff]/.test(node.value.raw))error(node,'Hardcoded Chinese template copy');
  if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&['i18nText','i18nHtml'].includes(node.callee.name)&&node.arguments[0]?.type==='Literal'){
   const key=node.arguments[0].value;if(!Object.hasOwn(zh,key))error(node,'Unknown language key: '+key);
  }
  if(name==='assets'+path.sep+'weapon-graph.js'&&node.type==='CallExpression'&&['n','choice'].includes(node.callee.name)&&node.arguments[0]?.type==='Literal'&&!Object.hasOwn(zh,node.arguments[0].value))error(node,'Unknown schema label key');
  if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'&&['textContent','innerText','title','placeholder'].includes(node.left.property.name)&&node.right.type==='Literal'&&typeof node.right.value==='string'&&/[A-Za-z]{2}/.test(node.right.value))error(node,'Hardcoded English UI copy');
  if(node.type==='TemplateElement'){
   if(/>\s*[A-Za-z]{2,}[^<$]*</.test(node.value.raw))error(node,'Hardcoded English HTML copy');
   if(/(?:aria-label|placeholder|title|alt)=["'][A-Za-z][^"'$]*["']/.test(node.value.raw))error(node,'Hardcoded HTML accessibility copy');
  }
  for(const value of Object.values(node)){if(Array.isArray(value)){for(const child of value)if(child?.type)walk(child,node);}else if(value?.type)walk(value,node);}
 }
 walk(ast,null);
}
for(const directory of ['assets','lib'])for(const name of fs.readdirSync(path.join(root,directory)))if(name.endsWith('.js'))inspect(path.join(root,directory,name));
const native=fs.readFileSync(path.join(root,'lib/desktop-pet.ps1'),'utf8');for(const [index,line]of native.split(/\r?\n/).entries())if(!line.trim().startsWith('#')&&/[\u3400-\u9fff]/.test(line))failures.push('lib/desktop-pet.ps1:'+(index+1)+' Hardcoded native copy');
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('PASS '+Object.keys(zh).length+' bilingual keys, matching placeholders, no hardcoded Chinese copy, checked UI text and schema keys');
