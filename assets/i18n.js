// All product copy lives in lang/*.yml. Shared by browser, host and combat workers.
let catalogs = {}, locale = 'zh_CN', revision = 0;
const listeners = new Set(), produced = new Map();
export const locales = Object.freeze(['zh_CN', 'en']);
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function t(key, args = {}) {
  const message = catalogs[locale]?.[key] ?? catalogs.zh_CN?.[key] ?? key;
  const text = message.replace(/\{(\w+)\}/g, (all, name) => args[name] === undefined ? all : String(args[name]));
  if(typeof document !== 'undefined') {
    produced.set(text, {key, args: {...args}});
    if(produced.size > 4096) produced.delete(produced.keys().next().value);
  }
  return text;
}
export const h = (key, args) => escapeHtml(t(key, args));
const dynamicText = new Set(), dynamicByNode = new WeakMap();
export function bindText(node, read, property = 'textContent') {
  let bindings=dynamicByNode.get(node);
  if(!bindings){bindings=new Map();dynamicByNode.set(node,bindings);dynamicText.add(new WeakRef(node));if(dynamicText.size>4096)for(const reference of dynamicText){const item=reference.deref();if(!item||!item.isConnected)dynamicText.delete(reference);}}
  const value=String(read()), previous=bindings.get(property), isText=property==='textContent'||property==='innerText';
  let target=previous?.target;
  if(isText){
    if(!target||target.parentNode!==node){node.textContent='';target=document.createTextNode(value);node.append(target);}
    else if(target.nodeValue!==value)target.nodeValue=value;
  }else if(property.startsWith('@')){const name=property.slice(1);if(node.getAttribute(name)!==value)node.setAttribute(name,value);}
  else if(node[property]!==value)node[property]=value;
  bindings.set(property,{read,last:value,target});return value;
}
export const bindAttribute=(node,name,read)=>bindText(node,read,'@'+name);
listeners.add(()=>{
  for(const reference of dynamicText){
    const node=reference.deref();if(!node){dynamicText.delete(reference);continue;}if(!node.isConnected)continue;
    for(const [property,binding]of dynamicByNode.get(node)||[]){
      const owned=binding.target?binding.target.parentNode===node&&binding.target.nodeValue===binding.last:String(property.startsWith('@')?node.getAttribute(property.slice(1)):node[property])===binding.last;
      if(!owned){dynamicByNode.get(node).delete(property);continue;}
      bindText(node,binding.read,property);
    }
  }
});
export const getLanguage = () => locale;
export const getCatalogs = () => catalogs;
export const getLanguageRevision = () => revision;
export function setLanguage(nextCatalogs = catalogs, nextLocale = locale) {
  if(!locales.includes(nextLocale)) throw new Error('Invalid locale');
  catalogs = nextCatalogs; locale = nextLocale; revision++;
  for(const listener of listeners) listener();
}
export function onLanguageChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }

export async function loadLanguageFiles(directory = new URL('../lang/', import.meta.url)) {
  const [{readFile}, {parseDocument}] = await Promise.all([import('node:fs/promises'), import('yaml')]);
  const pairs = await Promise.all(locales.map(async name => {
    const location = directory instanceof URL ? new URL(name+'.yml', directory) : (await import('node:path')).join(directory,name+'.yml');
    const parsed = parseDocument(await readFile(location,'utf8'), {uniqueKeys:true});
    if(parsed.errors.length) throw parsed.errors[0];
    const data = parsed.toJS();
    if(!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(value => typeof value !== 'string')) throw new Error('Language files require flat string mappings');
    return [name,data];
  }));
  const next = Object.fromEntries(pairs);
  if(Object.keys(next.zh_CN).some(key => !Object.hasOwn(next.en,key)) || Object.keys(next.en).some(key => !Object.hasOwn(next.zh_CN,key))) throw new Error('Language resource keys differ');
  setLanguage(next); return next;
}
if(typeof process !== 'undefined' && process.versions?.node) await loadLanguageFiles();

export async function startBrowserLanguage() {
  const roots = new Set(), textBindings = new WeakMap(), attrBindings = new WeakMap();
  const attributes = ['title','placeholder','aria-label','aria-description','alt'];
  let stream, disposed = false, refreshing = null, lastPayload = '', etag = '', pollTimer;
  const skip = element => element?.closest('script,style,textarea,input,[contenteditable="true"],[data-i18n-skip]');
  function text(node, force = false) {
    if(skip(node.parentElement)) return;
    let binding = textBindings.get(node);
    if(!binding || (!force && binding.last !== node.nodeValue)) binding = produced.get(node.nodeValue);
    if(!binding) return;
    const value = t(binding.key,binding.args); textBindings.set(node,{...binding,last:value});
    if(node.nodeValue !== value) node.nodeValue = value;
  }
  function element(node, force = false) {
    if(node.hasAttribute('data-i18n-skip')) return;
    for(const name of attributes) {
      if(!node.hasAttribute(name)) continue;
      let bindings = attrBindings.get(node); if(!bindings) attrBindings.set(node,bindings = new Map());
      const current = node.getAttribute(name), previous = bindings.get(name);
      const binding = previous && (force || previous.last === current) ? previous : produced.get(current);
      if(!binding) continue;
      const value = t(binding.key,binding.args); bindings.set(name,{...binding,last:value});
      if(current !== value) node.setAttribute(name,value);
    }
    for(const child of node.childNodes) { if(child.nodeType === 3) text(child,force); else if(child.nodeType === 1) element(child,force); }
  }
  const observer = new MutationObserver(records => {
    for(const record of records) {
      if(record.type === 'characterData') text(record.target);
      else if(record.type === 'attributes') element(record.target);
      else for(const node of record.addedNodes) { if(node.nodeType === 3) text(node); else if(node.nodeType === 1) element(node); }
    }
  });
  const unsubscribe = onLanguageChange(() => {
    for(const root of roots) { root.lang = locale === 'en' ? 'en' : 'zh-CN'; element(root,true); }
    document.dispatchEvent(new CustomEvent('fk-the-ai:language',{detail:{locale,revision}}));
  });
  async function refresh() {
    if(disposed) return;
    if(refreshing) return refreshing;
    refreshing = (async () => {
      const response = await fetch('/fk-the-ai/api/language',{cache:'no-store',headers:etag?{'If-None-Match':etag}:{}});
      if(response.status===304)return;
      etag=response.headers.get('ETag')||'';
      if(!response.ok) throw new Error('Language resources unavailable');
      const payload = await response.json(), signature = JSON.stringify(payload);
      if(signature === lastPayload) return;
      lastPayload = signature; setLanguage(payload.catalogs,payload.locale);
    })().catch(error => console.warn('[FK The AI] language:',error.message)).finally(() => {refreshing = null;});
    return refreshing;
  }
  await refresh();
  if(typeof EventSource !== 'undefined') {
    stream = new EventSource('/fk-the-ai/api/lang-events');
    stream.addEventListener('language-change',refresh);
    stream.onopen = refresh;
  }
  // Reconnect/proxy fallback also catches lost events. Invalid edits keep the last good catalog.
  pollTimer = setInterval(refresh,3000);
  return {
    refresh,
    observe(root) { roots.add(root); root.lang = locale === 'en' ? 'en' : 'zh-CN'; element(root); observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes}); },
    async setLocale(next) {
      const response = await fetch('/fk-the-ai/api/language',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locale:next})});
      if(!response.ok) throw new Error('Cannot save language');
      await refresh();
    },
    dispose() { disposed = true; clearInterval(pollTimer); stream?.close(); observer.disconnect(); unsubscribe(); roots.clear(); }
  };
}
