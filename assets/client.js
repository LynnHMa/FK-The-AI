// ============================================================================
// FK The AI - 客户端核心 Runtime (精准碰撞检测 + 多重解气武器形态 + 撕成碎片撕扯物理)
// NovaLine 极简无Emoji高精动力学版
// ============================================================================

(async function () {
  if (window.__FK_THE_AI_LOADED__) return;
  window.__FK_THE_AI_LOADED__ = true;

  const {t:i18nText,h:i18nHtml,bindText,bindAttribute,onLanguageChange,getLanguage,startBrowserLanguage}=await import('/fk-the-ai/i18n.js');
  const languageUI=await startBrowserLanguage();
  let combatModule;
  try { combatModule = await import('/fk-the-ai/combat.js'); }
  catch (error) { window.__FK_THE_AI_LOADED__ = false; console.error(i18nText("client.001"), error); return; }
  const { WEAPONS, WEAPON_KEYS, weaponCatalog, DEFAULT_SETTINGS, THEMES, THEME_COLOR_KEYS, resolveTheme, BODY_PARTS, validTexture, normalizeSettings, createCombat, normalizeRig, loadPuppetImages } = combatModule;
  const {createPet}=await import('/fk-the-ai/pet.js');
  const {createModeler,modelIcon}=await import('/fk-the-ai/modeler.js');
  const {createWordCloud}=await import('/fk-the-ai/word-cloud.js');
  const {createWeaponEditor}=await import('/fk-the-ai/weapon-editor.js');
  const {createDialogueEditor}=await import('/fk-the-ai/dialogue-editor.js');
  const {attachWindowResize}=await import('/fk-the-ai/window-layout.js');
  let weaponEditor,dialogueEditor,weaponStripSignature='',petView='overview';
  const effectiveSettings=()=>({...settings,dialogue:state.config?.presets?.find(p=>p.id===state.target.id)?.dialogue||state.config?.activeTarget?.dialogue||settings.dialogue});
  const catalog=()=>weaponCatalog(settings);
  let pet,modeler,wordCloud,petReady=false,desktopArenaActive=false;
  let combat, settings = normalizeSettings(), settingsTimer, settingsRevision = 0, settingsInitialized = false;
  let targetRevision = 0, statsRevision = 0, targetImageRevision=0, targetImageKey='', imageUploadRevision=0;
  let pendingHits = [], sendingHits = [], beatTimer = null, beatPromise = null;
  let sessionId = window.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2), hitSequence = 0;
  let confirmedDamage = 0;
  let settingsStatus='', damageStatus='', targetStatus='', targetBusy=false;
  function showSaveStatus(){document.getElementById('fk-save-status').textContent=[damageStatus,settingsStatus,targetStatus].filter(Boolean).join(' · ');}

  const state = {
    isOpen: false,
    currentTab: "arena",
    config: null,
    currentWeapon: "fist",
    combo: 0,
    totalDamage: 0,
    recentModelName: "deepseek-flash",
    customModelName: "",
    target: {
      id: "default_ai",
      name: i18nText("client.002"),
      avatarImg: null
    }
  };

  const controls = [
    ['power',"client.003",.1,5,.1],['knockback',"client.004",0,3,.1],['rate',"client.005",.4,2.5,.1],
    ['toughness',"client.006",.25,4,.05],['gravity',"client.007",0,2.5,.1],['bounce',"client.008",0,.95,.05],
    ['targetScale',"client.009",.65,1.4,.05],['shake',"client.010",0,1.5,.1],['hitstop',"client.011",0,2,.1],
    ['particles',"client.012",0,2,.1],['volume',"client.013",0,1,.05],['slowMotion',"client.014",.25,1,.05],
    ['zoom',"client.015",0,3,.1],['recoil',"client.016",0,2,.1],['gunSpread',"client.017",.2,2,.1],['energyFx',"client.018",0,2,.1],['particleSize',"client.019",.25,4,.25],['particleLimit',"client.020",500,6000,100]
  ];
  function rangeControl(key,labelKey,min,max,step,weaponControl=false) {
    const label=i18nText(labelKey);
    return `<label class="fk-ai-control-row"><span>${label}</span><input data-label-key="${labelKey}" aria-label="${weaponControl?i18nText("client.021"):''}${label}" type="range" class="fk-ai-slider" data-${weaponControl?'weapon':'setting'}="${key}" min="${min}" max="${max}" step="${step}"><output id="fk-output-${weaponControl?'weapon-':''}${key}"></output></label>`;
  }
  function mountCombatControls() {
    const stage=document.getElementById('fk-stage');
    const strip=document.createElement('div');strip.className='fk-ai-weapon-strip';
    strip.innerHTML=Object.entries(WEAPONS).map(([id,w],i)=>`<button class="fk-ai-weapon-pill ${id==='fist'?'active':''}" data-wpn="${id}" title="${w.hint}"><kbd>${WEAPON_KEYS[i]}</kbd>${w.name}</button>`).join('');
    stage.insertAdjacentElement('afterend',strip);
    // The arena is a stage/tool column next to a scrollable inspector.
    const column=document.createElement('div');column.className='fk-ai-stage-column';
    stage.before(column);column.append(stage,strip);
    document.querySelector('.fk-ai-fx-controls').innerHTML=
      `<label class="fk-ai-sidebar-sec-title" for="fk-input-model">${i18nHtml("client.022")}</label>`+
      `<input type="text" maxlength="80" class="fk-ai-input-text" id="fk-input-model" placeholder="${i18nHtml("client.023")}">`+
      `<button class="fk-ai-btn-action" id="fk-btn-respawn">${i18nHtml("client.024")}<kbd>${i18nHtml("client.025")}</kbd></button>`+
      `<div class="fk-ai-presets"><button data-preset="soft">${i18nHtml("client.026")}</button><button data-preset="arcade">${i18nHtml("client.027")}</button><button data-preset="chaos">${i18nHtml("client.028")}</button></div>`+
      `<details open><summary>${i18nHtml("client.029")}</summary>`+controls.slice(0,4).map(c=>rangeControl(...c)).join('')+controls.slice(7,16).map(c=>rangeControl(...c)).join('')+'</details>'+
      `<details><summary>${i18nHtml("client.030")}</summary>`+controls.slice(16).map(c=>rangeControl(...c)).join('')+rangeControl('liquidAlpha',"client.031",0,1,.05)+`<label class="fk-ai-control-row"><span>${i18nHtml("client.032")}</span><input aria-label="${i18nHtml("client.032")}" type="range" class="fk-ai-slider" id="fk-slider-blood" min="0" max="500" value="25"><output id="fk-output-liquid">25</output></label>`+
      `<label class="fk-ai-control-row"><span>${i18nHtml("client.034")}</span><input aria-label="${i18nHtml("client.033")}" id="fk-select-blood-color" type="color" value="#38bdf8"></label>`+
      `<div class="fk-ai-texture-tools"><img id="fk-particle-preview" alt="${i18nHtml("client.035")}" hidden><button type="button" id="fk-particle-upload">${i18nHtml("client.036")}</button><button type="button" id="fk-particle-reset">${i18nHtml("client.037")}</button><input id="fk-particle-file" type="file" accept="image/*" hidden></div><small class="fk-ai-editor-hint">${i18nHtml("client.038")}</small></details>`+
      `<details><summary>${i18nHtml("client.039")}</summary>`+controls.slice(4,7).map(c=>rangeControl(...c)).join('')+`<fieldset class="fk-inspector-section"><legend>${i18nHtml('rope.title')}</legend><label class="fk-ai-control-row"><input type="checkbox" id="fk-rope-enabled"><span>${i18nHtml('rope.enabled')}</span></label><label class="fk-ai-control-row"><span>${i18nHtml('rope.part')}</span><select id="fk-rope-part"></select></label>${[['x','rope.x',-50,50,1],['y','rope.y',-50,50,1],['length','rope.length',0,8000,1]].map(([id,key,min,max,step])=>`<label class="fk-ai-control-row"><span>${i18nHtml(key)}</span><input class="fk-ai-input-text" type="number" id="fk-rope-${id}" min="${min}" max="${max}" step="${step}"></label>`).join('')}<button type="button" id="fk-rope-pick">${i18nHtml('rope.pick')}</button><small class="fk-ai-editor-hint">${i18nHtml('rope.hint')}</small></fieldset></details>`+
      `<details open><summary id="fk-weapon-settings-title">${i18nHtml("client.021")}</summary>`+['damage','force','rate'].map((key,i)=>rangeControl(key,["client.040","client.041","client.042"][i],.2,3,.1,true)).join('')+`<label class="fk-ai-control-row"><span>${i18nHtml("client.043")}</span><select id="fk-audio-event" aria-label="${i18nHtml("client.043")}"><option value="attack">${i18nHtml("client.044")}</option><option value="hit">${i18nHtml("client.045")}</option><option value="charge">${i18nHtml("client.046")}</option><option value="release">${i18nHtml("client.047")}</option><option value="miss">${i18nHtml("client.048")}</option></select></label><label class="fk-ai-control-row"><span>${i18nHtml("client.049")}</span><button id="fk-audio-upload" type="button">${i18nHtml("client.050")}</button><button id="fk-audio-reset" type="button">${i18nHtml("client.051")}</button><input id="fk-audio-file" type="file" accept="audio/*" hidden></label><small id="fk-audio-label" class="fk-ai-editor-hint">${i18nHtml("client.052")}</small></details>`+
      `<details><summary>${i18nHtml("client.053")}</summary><div class="fk-ai-toggles"><label><input id="fk-pet-enabled" type="checkbox">${i18nHtml("client.054")}</label><label><input id="fk-pet-speech" type="checkbox">${i18nHtml("client.055")}</label><label><input id="fk-pet-gravity" type="checkbox">${i18nHtml("client.056")}</label></div></details>`+
      `<div class="fk-ai-toggles">`+[['swearMask',i18nText("client.057")],['flash',i18nText("client.058")],['trails',i18nText("client.059")],['numbers',i18nText("client.060")],['autoRebuild',i18nText("client.061")]].map(([key,label])=>`<label><input type="checkbox" data-setting="${key}">${label}</label>`).join('')+'</div>'+
      `<div class="fk-ai-settings-actions"><button id="fk-settings-export">${i18nHtml("client.062")}</button><button id="fk-settings-import">${i18nHtml("client.063")}</button><input type="file" id="fk-settings-file" accept="application/json,.json" hidden></div><div class="fk-ai-settings-actions"><button id="fk-puppet-export">${i18nHtml("client.064")}</button><button id="fk-puppet-import">${i18nHtml("client.065")}</button><input type="file" id="fk-puppet-file" accept="application/json,.json" hidden></div>`+
      `<button class="fk-ai-btn-reset" id="fk-settings-reset">${i18nHtml("client.066")}</button><button class="fk-ai-btn-reset" id="fk-btn-reset-dmg">${i18nHtml("client.067")}</button>`;
    for(const key of ['enabled','part','x','y','length'])document.getElementById('fk-rope-'+key).onchange=e=>{
      const value=key==='enabled'?e.target.checked:key==='part'?e.target.value:Number(e.target.value)/(key==='length'?1:100);settings.rope[key]=value;saveSettings();syncRopeControls();
    };
    document.getElementById('fk-rope-pick').onclick=()=>{combat?.pickRopeAttachment();bindText(document.getElementById('fk-rope-pick'),()=>i18nText('rope.picking'));};
    document.querySelectorAll('[data-setting]').forEach(el=>el.addEventListener('input',()=>{
      settings[el.dataset.setting]=el.type==='checkbox'?el.checked:Number(el.value);saveSettings();syncSettingsUI();
    }));
    document.querySelectorAll('[data-weapon]').forEach(el=>el.addEventListener('input',()=>{
      (settings.weaponTuning[state.currentWeapon]??={})[el.dataset.weapon]=Number(el.value);saveSettings();syncWeaponControls();
    }));
    const presets={soft:{...DEFAULT_SETTINGS,shake:.15,hitstop:.4,particles:.4,liquid:10,volume:.25},
      arcade:{...DEFAULT_SETTINGS},chaos:{...DEFAULT_SETTINGS,knockback:1.7,power:1.4,toughness:.6,shake:1,particles:1.5,liquid:50,bounce:.7}};
    document.querySelectorAll('[data-preset]').forEach(el=>el.addEventListener('click',()=>{
      settings=normalizeSettings({...presets[el.dataset.preset],modelName:settings.modelName,liquidColor:settings.liquidColor,particleTexture:settings.particleTexture,theme:settings.theme,weaponSounds:settings.weaponSounds,customWeapons:settings.customWeapons,dialogue:settings.dialogue,rope:settings.rope,pet:settings.pet,swearWords:settings.swearWords,swearMask:settings.swearMask});saveSettings();syncSettingsUI();
    }));
    document.getElementById('fk-settings-reset').onclick=()=>{settings=normalizeSettings({customWeapons:settings.customWeapons,dialogue:settings.dialogue,theme:settings.theme,pet:settings.pet,swearWords:settings.swearWords,swearMask:settings.swearMask});saveSettings();syncSettingsUI();};
    document.getElementById('fk-settings-export').onclick=()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,settings},null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='fk-combat-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    document.getElementById('fk-settings-import').onclick=()=>document.getElementById('fk-settings-file').click();
    document.getElementById('fk-settings-file').onchange=async e=>{
      try {
        const file=e.target.files?.[0];if(!file)return;if(file.size>24000000)throw new Error(i18nText("client.068"));
        const data=JSON.parse(await file.text());if(data.version!==1||!data.settings)throw new Error(i18nText("client.069"));
        settings=normalizeSettings({...data.settings,swearWords:settings.swearWords});saveSettings();syncSettingsUI();
      }catch(error){settingsStatus=error.message;showSaveStatus();}
      e.target.value='';
    };
    document.getElementById('fk-audio-upload').onclick=()=>document.getElementById('fk-audio-file').click();
    document.getElementById('fk-audio-event').onchange=syncWeaponControls;
    document.getElementById('fk-audio-file').onchange=async e=>{
      const file=e.target.files?.[0],id=state.currentWeapon,event=document.getElementById('fk-audio-event').value;
      try {
        if(!file)return;if(!file.type.startsWith('audio/')||file.size>1048576)throw new Error(i18nText("client.070"));
        const context=new AudioContext();try {const buffer=await context.decodeAudioData(await file.arrayBuffer());if(buffer.duration>10)throw new Error(i18nText("client.071"));}finally{await context.close();}
        const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
        const next=normalizeSettings({...settings,weaponSounds:{...settings.weaponSounds,[id]:{...settings.weaponSounds[id],[event]:src}}});
        if(next.weaponSounds[id]?.[event]!==src)throw new Error(i18nText("client.072"));
        settings=next;saveSettings();syncWeaponControls();
      }catch(error){settingsStatus=error.message;showSaveStatus();}finally{e.target.value='';}
    };
    document.getElementById('fk-audio-reset').onclick=()=>{const sounds=settings.weaponSounds[state.currentWeapon];if(sounds)delete sounds[document.getElementById('fk-audio-event').value];saveSettings();syncWeaponControls();};
    for(const key of ['enabled','speech','gravity'])document.getElementById('fk-pet-'+key).onchange=e=>{settings.pet[key]=e.target.checked;saveSettings();syncSettingsUI();if(key==='enabled'&&e.target.checked)pet?.open();};
    document.getElementById('fk-puppet-export').onclick=()=>exportJson('fk-puppet-presets.json',{version:1,presets:state.config?.presets||[],activeTarget:state.target.id});
    document.getElementById('fk-puppet-import').onclick=()=>document.getElementById('fk-puppet-file').click();
    document.getElementById('fk-puppet-file').onchange=async e=>{
      try {const f=e.target.files?.[0];if(!f)return;if(f.size>32000000)throw new Error(i18nText("client.073"));const d=JSON.parse(await f.text());if(d.version!==1||!Array.isArray(d.presets))throw new Error(i18nText("client.074"));await targetOperation('/presets','POST',d);}
      catch(error){targetStatus=error.message;showSaveStatus();}finally{e.target.value='';}
    };
    document.addEventListener('keydown',e=>{
      if(document.querySelector('.fk-part-dialog[open]'))return;
      if(e.key==='Escape'&&!document.getElementById('fk-theme-panel').hidden)return;
      if(!state.isOpen||state.currentTab!=='arena'||e.ctrlKey||e.altKey||e.metaKey||e.repeat||e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(e.code==='KeyR'){e.preventDefault();combat.reset();}
      const index=WEAPON_KEYS.indexOf(e.key);if(index>=0){e.preventDefault();document.querySelectorAll('.fk-ai-weapon-pill')[index].click();}
      if(e.key==='Escape') document.getElementById('fk-ai-btn-close').click();
    });
    document.getElementById('fk-particle-upload').onclick=()=>document.getElementById('fk-particle-file').click();
    let particleUploadRevision=0;
    document.getElementById('fk-particle-file').onchange=async e=>{
      const revision=++particleUploadRevision;
      try {const file=e.target.files?.[0];if(!file)return;const texture=await encodeTexture(file,128);
        if(revision!==particleUploadRevision)return;
        settings.particleTexture=texture;saveSettings();syncSettingsUI();
      }catch(error){settingsStatus=error.message;showSaveStatus();}finally{e.target.value='';}
    };
    document.getElementById('fk-particle-reset').onclick=()=>{particleUploadRevision++;settings.particleTexture='';saveSettings();syncSettingsUI();};
    mountThemeControls();
    mountTargetEditor();
    mountSidebarModules();
    syncSettingsUI();
  }
  function mountSidebarModules() {
    const sidebar=document.getElementById('fk-sidebar'),fx=sidebar.querySelector('.fk-ai-fx-controls');
    const nav=document.createElement('nav');nav.className='fk-module-nav';bindAttribute(nav,"aria-label",()=>i18nText("client.075"));
    const modules=[['targets',i18nText("client.076")],['model',i18nText("client.077")],['feedback',i18nText("client.078")],['physics',i18nText("client.079")],['particles',i18nText("client.080")],['weapon',i18nText("client.081")],['workshop',i18nText("client.082")],['dialogue',i18nText("client.083")],['pet',i18nText("client.084")],['files',i18nText("client.085")]];
    const panels={};for(const [id,label] of modules){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.module=id;button.setAttribute('aria-controls','fk-module-'+id);nav.append(button);
      const panel=document.createElement('section');panel.id='fk-module-'+id;panel.className='fk-module-panel';panel.dataset.modulePanel=id;panel.setAttribute('aria-label',label);panels[id]=panel;
      const title=document.createElement('h3');title.textContent=label;panel.append(title);sidebar.append(panel);
      button.onclick=()=>selectSidebarModule(id);
    }
    sidebar.prepend(nav);
    function unpack(node,panel){if(node.tagName==='DETAILS'){const summary=node.querySelector(':scope > summary');if(summary?.id)panel.querySelector('h3').id=summary.id;summary?.remove();panel.append(...node.childNodes);node.remove();}else panel.append(node);}
    unpack(sidebar.querySelector('.fk-ai-inspector-group'),panels.targets);
    unpack(document.getElementById('fk-target-editor'),panels.model);
    // Keep the editor identity for persistence and pending-operation disabling.
    panels.model.id='fk-target-editor';nav.querySelector('[data-module="model"]').setAttribute('aria-controls','fk-target-editor');panels.model.classList.add('fk-ai-target-editor');
    const details=[...fx.querySelectorAll(':scope > details')];
    for(const [i,id] of ['feedback','particles','physics','weapon','pet'].entries())unpack(details[i],panels[id]);
    const toggles=fx.querySelector(':scope > .fk-ai-toggles');
    const mask=toggles.querySelector('[data-setting="swearMask"]').closest('label');panels.weapon.append(mask);
    panels.feedback.append(toggles);
    const modelLabel=fx.querySelector('label'),modelName=document.getElementById('fk-input-model');panels.targets.append(modelLabel,modelName);
    panels.feedback.insertBefore(fx.querySelector('.fk-ai-presets'),panels.feedback.children[1]);
    panels.feedback.append(document.getElementById('fk-btn-respawn'));
    for(const node of [...fx.children])panels.files.append(node);fx.remove();
    const graphSettings=document.createElement('div');graphSettings.id='fk-weapon-graph-settings';graphSettings.innerHTML=`<p class="fk-ai-editor-hint" data-bindings-status></p><button type="button" id="fk-weapon-bindings-edit">${i18nHtml("client.086")}</button>`;panels.weapon.append(graphSettings);
    graphSettings.querySelector('button').onclick=()=>{const w=catalog()[state.currentWeapon];if(!w?.graph)return;selectSidebarModule('workshop');weaponEditor.openWeaponSettings(w);};
    const workbench=document.createElement('section');workbench.id='fk-modeler';workbench.className='fk-modeler';workbench.hidden=true;document.querySelector('.fk-ai-stage-column').append(workbench);
    modeler=createModeler(workbench,{
      sidebar:panels.model,onSelect(id){const select=document.getElementById('fk-texture-part');select.value=id;syncTargetEditor();},
      onDraft(part){if(part){for(const k of ['x','y','width','height','rotation'])document.getElementById('fk-part-'+k).value=part[k];document.getElementById('fk-part-opacity').value=Math.round(part.opacity*100);document.getElementById('fk-part-opacity-value').value=Math.round(part.opacity*100)+'%';document.getElementById('fk-part-flipX').checked=part.flipX;document.getElementById('fk-part-flipY').checked=part.flipY;}},
      onCommit(document){
        const previous=state.config?.presets?.find(p=>p.id===state.target.id)||{},textures={};
        for(const p of document.rig)if(previous.textures?.[p.id]!==document.textures[p.id])textures[p.id]=document.textures[p.id]??null;
        const oldSequences=Object.fromEntries(Object.entries(previous.sequences||{}).filter(([id])=>document.rig.some(p=>p.id===id)));
        const sequencesChanged=Object.keys(oldSequences).length!==Object.keys(document.sequences).length||Object.entries(document.sequences).some(([id,next])=>{const old=oldSequences[id];return !old||old.fps!==next.fps||old.frames.length!==next.frames.length||old.frames.some((frame,i)=>frame!==next.frames[i]);});
        return targetOperation('/presets','PATCH',{id:state.target.id,rig:document.rig,groups:document.groups,layers:document.layers,bones:document.bones,...(Object.keys(textures).length?{textures}:{}),...(sequencesChanged?{sequences:document.sequences}:{})});
      },onError(error){targetStatus=error.message;showSaveStatus();}
    });
    const weaponWorkbench=document.createElement('section');weaponWorkbench.id='fk-weapon-workbench';weaponWorkbench.hidden=true;weaponWorkbench.innerHTML=`<header><strong>${i18nHtml("client.087")}</strong><span>${i18nHtml("client.088")}</span></header>`;document.querySelector('.fk-ai-stage-column').append(weaponWorkbench);
    weaponEditor=createWeaponEditor(panels.workshop,{previewHost:weaponWorkbench,getSettings:()=>settings,save(weapons){settings.customWeapons=weapons;saveSettings();refreshWeaponStrip();},equip(id){chooseWeapon(id);},exportJson});
    dialogueEditor=createDialogueEditor(panels.dialogue,{getKey:()=>state.target.id,getSettings:()=>effectiveSettings(),async save(dialogue){if(!state.target.id)throw new Error(i18nText("client.089"));if(!await targetOperation('/presets','PATCH',{id:state.target.id,dialogue}))throw new Error(targetStatus||i18nText("client.090"));}});
    dialogueEditor.sync();
    const body=document.querySelector('.fk-ai-body');
    const petPage=document.createElement('section');petPage.id='fk-view-pet';petPage.className='fk-pet-page';petPage.style.display='none';petPage.innerHTML=`<nav class="fk-pet-tabs"><button data-pet-view="overview">${i18nHtml("client.091")}</button><button data-pet-view="presets" data-module="targets">${i18nHtml("client.076")}</button></nav><div class="fk-pet-overview"><div class="fk-pet-intro"><span>${i18nHtml("client.092")}</span><h2>${i18nHtml("client.091")}</h2><p>${i18nHtml("client.093")}</p><button type="button" data-open-presets>${i18nHtml("client.094")}</button></div></div><div class="fk-pet-presets" hidden><aside class="fk-pet-library"></aside><div class="fk-preset-editor"><nav class="fk-preset-tabs"><button data-module="model">${i18nHtml("client.095")}</button><button data-module="dialogue">${i18nHtml("client.083")}</button></nav><div class="fk-preset-editor-body"><div class="fk-preset-canvas"></div><aside class="fk-preset-properties"></aside></div></div></div>`;body.append(petPage);
    petPage.querySelector('.fk-pet-overview').append(panels.pet);
    petPage.querySelector('.fk-pet-library').append(panels.targets);
    petPage.querySelector('.fk-preset-canvas').append(workbench);
    petPage.querySelector('.fk-preset-properties').append(panels.model,panels.dialogue);
    const presetFiles=document.createElement('div');presetFiles.className='fk-ai-settings-actions';for(const id of ['fk-puppet-export','fk-puppet-import','fk-puppet-file'])presetFiles.append(document.getElementById(id));panels.targets.append(presetFiles);
    const workshopPage=document.createElement('section');workshopPage.id='fk-view-workshop';workshopPage.className='fk-workshop-page';workshopPage.style.display='none';const workshopAside=document.createElement('aside');workshopAside.className='fk-workshop-properties';workshopAside.append(panels.workshop);weaponWorkbench.hidden=false;workshopPage.append(weaponWorkbench,workshopAside);body.append(workshopPage);
    // Arena owns only its own settings. Other modules have separate page trees.
    const arenaIds=['feedback','physics','particles','weapon','files'];for(const button of [...nav.children])if(!arenaIds.includes(button.dataset.module))button.remove();
    const edge=document.createElement('button');edge.id='fk-sidebar-edge';edge.className='fk-sidebar-edge';edge.type='button';bindAttribute(edge,"aria-label",()=>i18nText("client.096"));edge.setAttribute('aria-expanded','true');edge.setAttribute('aria-controls','fk-sidebar');edge.innerHTML=`<span>›</span>`;
    document.getElementById('fk-view-arena').insertBefore(edge,sidebar);edge.onclick=()=>{const collapsed=document.getElementById('fk-view-arena').classList.toggle('fk-sidebar-collapsed');edge.setAttribute('aria-expanded',String(!collapsed));bindAttribute(edge,"aria-label",()=>collapsed?i18nText("client.097"):i18nText("client.096"));edge.querySelector('span').textContent=collapsed?'‹':'›';};
    petPage.querySelectorAll('[data-pet-view]').forEach(button=>button.onclick=()=>{petView=button.dataset.petView;selectSidebarModule(petView==='overview'?'pet':'model');});petPage.querySelector('[data-open-presets]').onclick=()=>selectSidebarModule('model');petPage.querySelectorAll('.fk-preset-tabs button').forEach(button=>button.onclick=()=>selectSidebarModule(button.dataset.module));
    for(const panel of [panels.targets,panels.pet,panels.workshop])panel.hidden=false;
    selectSidebarModule('feedback');
  }
  function navigateTab(tab){
    state.currentTab=tab;for(const name of ['arena','stats','pet','workshop']){const page=document.getElementById('fk-view-'+name);if(page)page.style.display=tab===name?'flex':'none';}
    document.querySelectorAll('.fk-ai-nav-btn[data-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.tab===tab);button.setAttribute('aria-selected',String(button.dataset.tab===tab));});
    syncSimulationActivity();requestAnimationFrame(()=>{combat?.resize();if(tab==='pet'&&petView==='presets')modeler?.refresh();});
  }
  function selectSidebarModule(id){
    if(['feedback','physics','particles','weapon','files'].includes(id)){document.querySelectorAll('#fk-sidebar [data-module-panel]').forEach(panel=>panel.hidden=panel.dataset.modulePanel!==id);document.querySelectorAll('#fk-sidebar [data-module]').forEach(button=>{const on=button.dataset.module===id;button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));});navigateTab('arena');return;}
    if(id==='workshop'){navigateTab('workshop');return;}
    if(id==='pet')petView='overview';else petView='presets';
    document.querySelector('.fk-pet-overview').hidden=petView!=='overview';document.querySelector('.fk-pet-presets').hidden=petView!=='presets';
    const modeling=id!=='dialogue';document.getElementById('fk-modeler').hidden=!modeling;document.getElementById('fk-target-editor').hidden=!modeling;document.getElementById('fk-module-dialogue').hidden=modeling;document.querySelector('.fk-preset-canvas').hidden=!modeling;
    document.querySelectorAll('[data-pet-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.petView===petView)));document.querySelectorAll('.fk-preset-tabs [data-module]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.module===(modeling?'model':'dialogue'))));navigateTab('pet');
  }
  function syncSimulationActivity(){
    combat?.setActive(!desktopArenaActive&&state.isOpen&&state.currentTab==='arena');
    weaponEditor?.setVisible(!desktopArenaActive&&state.isOpen&&state.currentTab==='workshop');
  }
  function mountThemeControls() {
    const panel=document.createElement('section');panel.id='fk-theme-panel';panel.className='fk-ai-theme-panel';panel.hidden=true;bindAttribute(panel,"aria-label",()=>i18nText("client.098"));
    panel.innerHTML=`<div class="fk-ai-theme-heading"><strong>${i18nHtml("client.100")}</strong><button type="button" id="fk-theme-close" aria-label="${i18nHtml("client.099")}">×</button></div>`+
      `<div class="fk-ai-theme-modes" role="group" aria-label="${i18nHtml("client.101")}">`+[['dark',i18nText("client.102")],['light',i18nText("client.103")],['system',i18nText("client.104")]].map(([id,label])=>`<button type="button" data-theme-mode="${id}" aria-pressed="false">${label}</button>`).join('')+'</div>'+
      `<div class="fk-ai-theme-palettes" role="group" aria-label="${i18nHtml("client.105")}">`+Object.entries(THEMES).map(([id,t])=>`<button type="button" data-theme-palette="${id}" aria-pressed="false"><span class="fk-ai-theme-swatch" aria-hidden="true"></span>${t.name}</button>`).join('')+'</div>'+
      `<label class="fk-ai-theme-custom-toggle"><input type="checkbox" id="fk-theme-custom">${i18nHtml("client.106")}</label>`+
      `<div class="fk-ai-theme-colors">`+Object.entries(THEME_COLOR_KEYS).map(([id,label])=>`<label><span>${label}</span><input type="color" data-theme-color="${id}" aria-label="${i18nHtml("client.107", {v0: label})}"></label>`).join('')+'</div>'+
      `<p class="fk-ai-editor-hint" id="fk-theme-mode-hint"></p><button type="button" class="fk-ai-theme-reset" id="fk-theme-reset">${i18nHtml("client.108")}</button>`;
    document.querySelector('.fk-ai-modal').append(panel);
    const toggle=document.getElementById('fk-theme-toggle');
    const close=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');};
    toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
    document.getElementById('fk-theme-close').onclick=()=>{close();toggle.focus();};
    document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!toggle.contains(e.target))close();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();close();toggle.focus();}});
    panel.querySelectorAll('[data-theme-mode]').forEach(el=>el.onclick=()=>{settings.theme.mode=el.dataset.themeMode;saveSettings();syncSettingsUI();});
    panel.querySelectorAll('[data-theme-palette]').forEach(el=>el.onclick=()=>{settings.theme.palette=el.dataset.themePalette;settings.theme.customEnabled=false;saveSettings();syncSettingsUI();});
    panel.querySelectorAll('[data-theme-color]').forEach(el=>el.oninput=()=>{
      const mode=resolveTheme(settings.theme,window.matchMedia('(prefers-color-scheme: dark)').matches).mode;
      settings.theme.custom[mode][el.dataset.themeColor]=el.value;settings.theme.customEnabled=true;saveSettings();syncSettingsUI();
    });
    document.getElementById('fk-theme-custom').onchange=e=>{settings.theme.customEnabled=e.target.checked;saveSettings();syncSettingsUI();};
    document.getElementById('fk-theme-reset').onclick=()=>{
      const mode=resolveTheme(settings.theme,window.matchMedia('(prefers-color-scheme: dark)').matches).mode;
      settings.theme.custom[mode]={};settings.theme.customEnabled=false;saveSettings();syncSettingsUI();
    };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',syncThemeUI);
  }
  function syncThemeUI() {
    const palette=resolveTheme(settings.theme,window.matchMedia('(prefers-color-scheme: dark)').matches);
    pet?.updateTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
    const variables={bg:palette.bg,surface:palette.surface,'surface-hover':palette.hover,border:palette.border,'border-focus':palette.accent,
      'accent-red':palette.danger,'accent-blue':palette.accent,'accent-amber':palette.warning,text:palette.text,'text-muted':palette.muted,'text-faint':palette.faint,
      selected:palette.selected,stage:palette.stage,overlay:palette.overlay,shadow:palette.shadow};
    for(const root of [document.getElementById('fk-ai-modal-overlay'),document.getElementById('fk-ai-float-btn')]) {
      if(!root)continue;root.dataset.themeMode=palette.mode;root.dataset.themePalette=palette.palette;root.style.colorScheme=palette.mode;
      for(const [key,value]of Object.entries(variables))root.style.setProperty('--nl-'+key,value);
    }
    const panel=document.getElementById('fk-theme-panel');if(!panel)return;
    panel.querySelectorAll('[data-theme-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.themeMode===settings.theme.mode)));
    panel.querySelectorAll('[data-theme-palette]').forEach(el=>{
      el.setAttribute('aria-pressed',String(el.dataset.themePalette===settings.theme.palette));
      const colors=THEMES[el.dataset.themePalette][palette.mode];el.style.setProperty('--swatch-bg',colors.bg);el.style.setProperty('--swatch-accent',colors.accent);
    });
    panel.querySelectorAll('[data-theme-color]').forEach(el=>el.value=palette[el.dataset.themeColor]);
    document.getElementById('fk-theme-custom').checked=settings.theme.customEnabled;
    modeler?.refresh();
    bindText(document.getElementById('fk-theme-mode-hint'),()=>i18nText("client.109")+(palette.mode==='dark'?i18nText("client.102"):i18nText("client.103"))+i18nText("client.110"), "textContent");
  }
  function syncRopeControls(){
    const select=document.getElementById('fk-rope-part');if(!select)return;
    const preset=(state.config?.presets||[]).find(p=>p.id===state.target?.id)||state.config?.activeTarget;
    const parts=preset?.rig||[],signature=JSON.stringify(parts.map(p=>[p.id,p.name]));
    if(select.dataset.parts!==signature){select.replaceChildren(new Option('', ''),...parts.map(p=>new Option(p.name,p.id)));select.dataset.parts=signature;}
    bindText(select.options[0],()=>i18nText('rope.autoPart'));select.value=parts.some(p=>p.id===settings.rope.part)?settings.rope.part:'';
    for(const key of ['enabled','x','y','length']){const el=document.getElementById('fk-rope-'+key);if(key==='enabled')el.checked=settings.rope.enabled;else if(document.activeElement!==el)el.value=settings.rope[key]*(key==='length'?1:100);}
    document.getElementById('fk-rope-pick').disabled=!state.target?.id;bindText(document.getElementById('fk-rope-pick'),()=>i18nText('rope.pick'));
  }
  function syncSettingsUI() {
    syncRopeControls();
    syncThemeUI();refreshWeaponStrip();weaponEditor?.sync();dialogueEditor?.sync();
    for(const el of document.querySelectorAll('[data-setting]')) {
      const value=settings[el.dataset.setting];if(el.type==='checkbox')el.checked=value;else el.value=value;
      const out=document.getElementById('fk-output-'+el.dataset.setting);if(out)out.textContent=Number(value).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+(el.dataset.setting==='particleLimit'?'':'×');
    }
    document.getElementById('fk-input-model').value=settings.modelName;
    for(const key of ['enabled','speech','gravity'])document.getElementById('fk-pet-'+key).checked=settings.pet[key];
    pet?.update(settings.pet);
    document.getElementById('fk-slider-blood').value=settings.liquid;
    document.getElementById('fk-output-liquid').textContent=settings.liquid;
    document.getElementById('fk-select-blood-color').value=settings.liquidColor;
    const preview=document.getElementById('fk-particle-preview');preview.hidden=!settings.particleTexture;
    if(settings.particleTexture)preview.src=settings.particleTexture;else preview.removeAttribute('src');
    syncWeaponControls();
  }
  function refreshWeaponStrip(){
    const strip=document.querySelector('.fk-ai-weapon-strip');if(!strip)return;const all=catalog(),signature=JSON.stringify(all);if(!all[state.currentWeapon]){state.currentWeapon='fist';combat?.selectWeapon('fist');}
    if(signature===weaponStripSignature)return;weaponStripSignature=signature;strip.replaceChildren();
    Object.entries(all).forEach(([id,w],index)=>{const button=document.createElement('button');button.className='fk-ai-weapon-pill'+(id===state.currentWeapon?' active':'');button.dataset.wpn=id;bindText(button,()=>w.hint, "title");const key=document.createElement('kbd');key.textContent=WEAPON_KEYS[index]||'✦';button.append(key,document.createTextNode(w.name));strip.append(button);});
  }
  function chooseWeapon(id){if(!catalog()[id])return;state.currentWeapon=id;combat?.selectWeapon(id);document.querySelectorAll('.fk-ai-weapon-pill').forEach(b=>b.classList.toggle('active',b.dataset.wpn===id));syncWeaponControls();}
  function syncWeaponControls() {
    const id=state.currentWeapon,w=catalog()[id]||WEAPONS.fist;
    bindText(document.getElementById('fk-weapon-hint'),()=>w.hint, "textContent");
    bindText(document.getElementById('fk-weapon-settings-title'),()=>w.name+i18nText("client.111"), "textContent");
    for(const el of document.querySelectorAll('[data-weapon]')) {
      const value=settings.weaponTuning[id]?.[el.dataset.weapon]||1;el.value=value;
      document.getElementById('fk-output-weapon-'+el.dataset.weapon).textContent=value.toFixed(1)+'×';
    }
    const graphSettings=document.getElementById('fk-weapon-graph-settings');if(graphSettings){graphSettings.hidden=!w.graph;if(w.graph){const node=w.graph.nodes.find(n=>n.type==='weaponSettings'),names={damage:i18nText("client.003"),force:i18nText("client.112"),rate:i18nText("client.113"),volume:i18nText("client.013"),pitch:i18nText("client.114"),soundEvent:i18nText("client.043")},bindings=w.graph.links.filter(l=>l.to===node?.id&&l.param);bindText(graphSettings.querySelector('p'),()=>bindings.length?bindings.map(l=>names[l.param]+' ← '+w.graph.nodes.find(n=>n.id===l.from)?.name).join(' · '):i18nText("client.115"), "textContent");}}
    const audioLabel=document.getElementById('fk-audio-label');if(audioLabel)bindText(audioLabel,()=>settings.weaponSounds?.[id]?.[document.getElementById('fk-audio-event').value]?i18nText("client.116"):i18nText("client.052"), "textContent");
  }
  function exportJson(filename,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function saveSettings() {
    settings=normalizeSettings(settings);settingsRevision++;combat?.updateSettings(effectiveSettings());pet?.update(settings.pet);
    settingsStatus=i18nText("client.117");showSaveStatus();
    document.getElementById('fk-output-liquid').textContent=settings.liquid;
    clearTimeout(settingsTimer);settingsTimer=setTimeout(persistSettings,350);
  }
  let settingsSaving=false;
  async function persistSettings() {
    if(settingsSaving)return;
    settingsSaving=true;const revision=settingsRevision;
    try {
      const res=await fetch('/fk-the-ai/api/combat-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});
      if(!res.ok)throw new Error(i18nText("client.118"));
      if(revision===settingsRevision){settingsStatus='';showSaveStatus();}
    }catch(error){settingsStatus=i18nText("client.118");showSaveStatus();clearTimeout(settingsTimer);settingsTimer=setTimeout(persistSettings,2000);}
    finally{settingsSaving=false;if(revision!==settingsRevision){clearTimeout(settingsTimer);settingsTimer=setTimeout(persistSettings,100);}}
  }
  function initCombat() {
    combat=createCombat(document.getElementById('fk-canvas'),{settings,
      onRopeAttachment(attachment){if(attachment){settings.rope={...settings.rope,...attachment,enabled:true};saveSettings();}syncRopeControls();},
      onStatus(message){if(message){document.getElementById('fk-weapon-hint').textContent=message;}},
      onSpeech(line){pet?.hitSpeech(line.text,effectiveSettings().dialogue.duration);},
      onHit(hit){
        statsRevision++;pendingHits.push({...hit,id:sessionId+':'+(++hitSequence)});
        state.totalDamage+=hit.damage;document.getElementById('fk-damage-val').textContent=state.totalDamage.toLocaleString();
        damageStatus=i18nText("client.119");showSaveStatus();
        if(!beatTimer)beatTimer=setTimeout(()=>{beatTimer=null;flushHits();},400);
      },
      onCombo(count,progress){state.combo=count;bindText(document.getElementById('fk-combo-val'),()=>i18nText("hud.combo",{count}), "textContent");document.getElementById('fk-combo-meter').style.width=progress*100+'%';},
      onCharge(progress){document.getElementById('fk-charge-meter').style.width=progress*100+'%';}
    });
    combat.setTargetEnabled(false);
    window.addEventListener('pagehide',()=>{
      const hits=[...sendingHits,...pendingHits];if(hits.length)navigator.sendBeacon?.('/fk-the-ai/api/beat',new Blob([JSON.stringify({hits:hits.slice(0,256)})],{type:'application/json'}));
    });
  }
  function flushHits() {
    if(beatPromise)return beatPromise;
    if(!pendingHits.length)return Promise.resolve();
    sendingHits=pendingHits.splice(0,256);
    beatPromise=(async()=>{
      try {
        const res=await fetch('/fk-the-ai/api/beat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hits:sendingHits}),keepalive:true});
        if(!res.ok)throw new Error(i18nText("client.120"));
        const data=await res.json();confirmedDamage=data.stats.totalDamageDealt;
        sendingHits=[];state.totalDamage=confirmedDamage+pendingHits.reduce((n,h)=>n+h.damage,0);
        document.getElementById('fk-damage-val').textContent=state.totalDamage.toLocaleString();
        damageStatus=pendingHits.length?i18nText("client.119"):'';showSaveStatus();
      }catch(error){pendingHits.unshift(...sendingHits);sendingHits=[];damageStatus=i18nText("client.120");showSaveStatus();}
      finally{beatPromise=null;if(pendingHits.length&&!beatTimer)beatTimer=setTimeout(()=>{beatTimer=null;flushHits();},1500);}
    })();return beatPromise;
  }

  function mountUI() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/fk-the-ai/client.css?v=" + Date.now();
    document.head.appendChild(link);

    const widget = document.createElement("div");
    widget.className = "fk-ai-widget";
    widget.id = "fk-ai-float-btn";
    widget.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 6h-2c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2H5c-1.1 0-2 .9-2 2v9c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-4-1h-6c-.55 0-1 .45-1 1h8c0-.55-.45-1-1-1zm4 12H5V9h14v8z"/></svg><div class="fk-ai-badge" id="fk-ai-badge-cnt">0</div>`;
    document.body.appendChild(widget);
    mountDesktopPet();

    const overlay = document.createElement("div");
    overlay.className = "fk-ai-modal-overlay";
    overlay.id = "fk-ai-modal-overlay";
    overlay.innerHTML = `<div class="fk-ai-modal">` +
      `<div class="fk-ai-header">` +
        `<span class="fk-ai-title">${i18nHtml("client.121")}</span>` +
        `<div class="fk-ai-nav">` +
          `<button class="fk-ai-nav-btn active" data-tab="arena">${i18nHtml("client.122")}</button>` +
          `<button class="fk-ai-nav-btn" data-tab="stats">${i18nHtml("client.123")}</button><button class="fk-ai-nav-btn" data-tab="pet" data-module="pet">${i18nHtml("client.084")}</button><button class="fk-ai-nav-btn" data-tab="workshop" data-module="workshop">${i18nHtml("client.082")}</button>` +
        '</div>' +
        `<div class="fk-ai-header-actions"><select id="fk-language" class="fk-ai-language" aria-label="${i18nHtml("language.select")}"><option value="zh_CN">${i18nHtml("language.zh_CN")}</option><option value="en">${i18nHtml("language.en")}</option></select><button class="fk-ai-theme-toggle" id="fk-theme-toggle" aria-expanded="false" aria-controls="fk-theme-panel">${i18nHtml("client.125")}</button><button class="fk-ai-close-btn" id="fk-ai-btn-close" aria-label="${i18nHtml("client.124")}">✕</button></div>` +
      '</div>' +
      `<div class="fk-ai-body">` +
        `<div class="fk-ai-arena-layout" id="fk-view-arena">` +
          `<div class="fk-ai-stage" id="fk-stage">` +
            `<canvas class="fk-ai-canvas" id="fk-canvas"></canvas>` +
            `<div class="fk-ai-hud-stats">` +
              `<span class="fk-ai-damage-label">${i18nHtml("client.126")}</span>` +
              `<span class="fk-ai-damage-val" id="fk-damage-val">0</span>` +
              `<span class="fk-ai-combo-val" id="fk-combo-val">${i18nHtml("client.127")}</span>` +
              `<div class="fk-ai-meter"><i id="fk-combo-meter"></i></div>` +
            '</div>' +
            `<div class="fk-ai-stage-caption"><span id="fk-weapon-hint"></span><div class="fk-ai-meter"><i id="fk-charge-meter"></i></div><span id="fk-save-status" role="status"></span></div>` +
          '</div>' +
          `<aside class="fk-ai-sidebar" id="fk-sidebar"><details class="fk-ai-inspector-group" open><summary>${i18nHtml("client.128")}</summary>` +
            `<span class="fk-ai-sidebar-sec-title">${i18nHtml("client.129")}</span>` +
            `<div class="fk-ai-target-list" id="fk-target-list"></div>` +
            `<form class="fk-ai-target-form" id="fk-target-form"><input aria-label="${i18nHtml("client.130")}" maxlength="60" class="fk-ai-input-text" id="fk-target-name" placeholder="${i18nHtml("client.130")}"><button class="fk-ai-btn-action" type="submit">${i18nHtml("client.131")}</button></form>` +
            `<div class="fk-ai-upload-box" id="fk-upload-box">${i18nHtml("client.132")}<input type="file" id="fk-file-selector" accept="image/*" style="display: none;" /></div>` +
            `</details><div class="fk-ai-fx-controls"></div>` +
          '</aside>' +
        '</div>' +
        `<div class="fk-ai-stats-layout" id="fk-view-stats" style="display: none;">` +
          `<div class="fk-ai-stats-grid">` +
            `<div class="fk-ai-stats-card"><div style="font-size: 11px; color: var(--nl-text-faint);">${i18nHtml("client.133")}</div><div class="fk-ai-stats-num" id="fk-stat-curses" style="color: var(--nl-accent-red);">0</div></div>` +
            `<div class="fk-ai-stats-card"><div style="font-size: 11px; color: var(--nl-text-faint);">${i18nHtml("client.134")}</div><div class="fk-ai-stats-num" id="fk-stat-msgs">0</div></div>` +
            `<div class="fk-ai-stats-card"><div style="font-size: 11px; color: var(--nl-text-faint);">${i18nHtml("client.135")}</div><div class="fk-ai-stats-num" id="fk-stat-files">0</div></div>` +
            `<div class="fk-ai-stats-card"><div style="font-size: 11px; color: var(--nl-text-faint);">${i18nHtml("client.136")}</div><div class="fk-ai-stats-num" id="fk-stat-words">0</div></div>` +
          '</div>' +
          `<div style="background: var(--nl-surface); padding: 14px; border-radius: 8px; border: 1px solid var(--nl-border);">` +
            `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"><span class="fk-ai-sidebar-sec-title">${i18nHtml("client.137")}</span><button class="fk-ai-nav-btn active" id="fk-btn-rescan">${i18nHtml("client.138")}</button></div>` +
            `<table class="fk-ai-table"><thead><tr><th>${i18nHtml("client.139")}</th><th>${i18nHtml("client.140")}</th><th>${i18nHtml("client.141")}</th><th>${i18nHtml("client.142")}</th><th>${i18nHtml("client.143")}</th></tr></thead><tbody id="fk-source-tbody"></tbody></table>` +
            `<div style="margin-top: 12px; display: flex; gap: 8px;"><input type="text" id="fk-src-name" placeholder="${i18nHtml("client.144")}" style="width: 140px; padding: 6px 10px; background: var(--nl-bg); border: 1px solid var(--nl-border); color: var(--nl-text); font-size: 12px; border-radius: 4px;" /><input type="text" id="fk-src-path" placeholder="${i18nHtml("client.145")}" style="flex: 1; padding: 6px 10px; background: var(--nl-bg); border: 1px solid var(--nl-border); color: var(--nl-text); font-size: 12px; border-radius: 4px;" /><button class="fk-ai-nav-btn" id="fk-btn-add-src" style="border-color: var(--nl-border-focus); color: var(--nl-accent-blue);">${i18nHtml("client.146")}</button></div>` +
          '</div>' +
          `<div style="background: var(--nl-surface); padding: 14px; border-radius: 8px; border: 1px solid var(--nl-border);">` +
            `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"><span class="fk-ai-sidebar-sec-title">${i18nHtml("client.147")}</span><button class="fk-ai-nav-btn" id="fk-btn-import-dict" style="border: 1px solid var(--nl-border);">${i18nHtml("client.148")}</button><input type="file" id="fk-dict-input" accept=".txt,.json" style="display: none;" /></div>` +
            `<div class="fk-ai-word-cloud" id="fk-cloud-list" aria-label="${i18nHtml("client.149")}"></div>` +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    languageUI.observe(overlay);
    const languageSelect=document.getElementById('fk-language');languageSelect.value=getLanguage();languageSelect.onchange=()=>languageUI.setLocale(languageSelect.value).catch(error=>console.error(error));
    onLanguageChange(()=>{languageSelect.value=getLanguage();weaponStripSignature='';refreshWeaponStrip();syncWeaponControls();});
    attachWindowResize(overlay.querySelector('.fk-ai-modal'));

    mountCombatControls();
    for(const input of overlay.querySelectorAll('input[data-label-key]'))bindAttribute(input,'aria-label',()=> (input.hasAttribute('data-weapon')?i18nText('client.021'):'')+i18nText(input.dataset.labelKey));
    for(const input of overlay.querySelectorAll('[data-theme-color]'))bindAttribute(input,'aria-label',()=>i18nText('client.107',{v0:THEME_COLOR_KEYS[input.dataset.themeColor]}));
    for(const [id,key]of Object.entries({width:'client.169',height:'client.170',x:'client.171',y:'client.172'}))bindAttribute(document.getElementById('fk-part-'+id),'aria-label',()=>i18nText('client.173',{v0:i18nText(key)}));
    wordCloud=createWordCloud(document.getElementById('fk-cloud-list'));

    bindEvents();
    initCombat();
    fetchStats();
  }

  function bindEvents() {
    const floatBtn = document.getElementById("fk-ai-float-btn");
    const overlay = document.getElementById("fk-ai-modal-overlay");
    const closeBtn = document.getElementById("fk-ai-btn-close");

    floatBtn.addEventListener("click", () => {
      overlay.classList.add("open");
      state.isOpen = true;
      syncSimulationActivity();
      fetchStats();
    });

    closeBtn.addEventListener("click", () => {
      overlay.classList.remove("open");
      state.isOpen = false;
      syncSimulationActivity();
      flushHits();
    });

    document.querySelectorAll(".fk-ai-nav-btn[data-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab=btn.dataset.tab;if(tab==='pet')selectSidebarModule(petView==='overview'?'pet':'model');else if(tab==='workshop')selectSidebarModule('workshop');else navigateTab(tab);
      });
    });

    document.querySelector('.fk-ai-weapon-strip').addEventListener('click',event=>{const button=event.target.closest('[data-wpn]');if(button)chooseWeapon(button.dataset.wpn);});

    document.getElementById("fk-input-model").addEventListener("input", (e) => {
        state.customModelName = e.target.value.trim();
        settings.modelName = state.customModelName;
        saveSettings();
      });
      document.getElementById("fk-btn-respawn").addEventListener("click", () => {
        combat.reset();
      });
      document.getElementById("fk-slider-blood").addEventListener("input", (e) => {
      settings.liquid = Number(e.target.value);
      saveSettings();
    });

    document.getElementById("fk-select-blood-color").addEventListener("change", (e) => {
      settings.liquidColor = e.target.value;
      saveSettings();
    });

    document.getElementById("fk-btn-reset-dmg").addEventListener("click", async () => {
      if (confirm(i18nText("client.150"))) {
        combat.setActive(false);
        try {
          await flushHits();
          if(pendingHits.length || sendingHits.length) throw new Error(i18nText("client.151"));
          const res = await fetch("/fk-the-ai/api/reset-damage", { method: "POST" });
          if(!res.ok) throw new Error(i18nText("client.152"));
          confirmedDamage = 0;state.totalDamage=0;state.combo=0;
          combat.resetCombo();
          document.getElementById("fk-damage-val").innerText = "0";
          bindText(document.getElementById("fk-combo-val"),()=>i18nText("hud.combo",{count:0}), "innerText");
          statsRevision++;
        } catch(error) { damageStatus=error.message;showSaveStatus(); }
        finally { syncSimulationActivity(); }
      }
    });

    const uploadBox = document.getElementById("fk-upload-box");
    const fileSel = document.getElementById("fk-file-selector");
    document.getElementById('fk-target-form').addEventListener('submit',async e=>{
      e.preventDefault();const input=document.getElementById('fk-target-name'),name=input.value.trim();
      if(!name||targetBusy)return;
      if(await targetOperation('/presets','POST',{name}))input.value='';
    });
    uploadBox.addEventListener("click", () => fileSel.click());
    fileSel.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) uploadAvatar(e.target.files[0]);
    });

    window.addEventListener("paste", (e) => {
      if (!state.isOpen || state.currentTab !== "arena") return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.includes("image")) {
          uploadAvatar(item.getAsFile());
          break;
        }
      }
    });

    const btnImport = document.getElementById("fk-btn-import-dict");
    const dictInput = document.getElementById("fk-dict-input");
    btnImport.addEventListener("click", () => dictInput.click());
    dictInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const res = await fetch("/fk-the-ai/api/import-dict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileContent: ev.target.result })
          });
          const d = await res.json();
          alert(i18nText("client.153") + d.addedCount + i18nText("client.154"));
          fetchStats();
        };
        reader.readAsText(e.target.files[0]);
      }
    });

    document.getElementById("fk-btn-add-src").addEventListener("click", async () => {
      const name = document.getElementById("fk-src-name").value.trim();
      const p = document.getElementById("fk-src-path").value.trim();
      if (!name || !p) return;
      await fetch("/fk-the-ai/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path: p, type: "codex" })
      });
      document.getElementById("fk-src-name").value = "";
      document.getElementById("fk-src-path").value = "";
      fetchStats();
    });

    document.getElementById("fk-btn-rescan").addEventListener("click", fetchStats);
  }

  function mountDesktopPet(){
    pet=createPet(document.body,{
      settings:settings.pet,isReady:()=>settingsInitialized&&petReady,getFrame:()=>combat?.petFrame(),getState:()=>combat?.exportState(),
      onSupport(supported){for(const key of ['enabled','speech','gravity']){const input=document.getElementById('fk-pet-'+key);if(input){input.disabled=!supported;input.closest('label').title=supported?'':i18nText('pet.003');}}},
      onStatus(message){const label=document.getElementById('fk-pet-enabled')?.closest('label');if(label)label.title=message;},
      onMove(x,y){settings.pet.desktopX=x;settings.pet.desktopY=y;saveSettings();},
      onGravity(gravity){settings.pet.gravity=gravity;saveSettings();syncSettingsUI();},
      async onBeforeArena(){await flushHits();combat.setActive(false);weaponEditor?.setVisible(false);},
      async onTransfer(value){combat.setActive(false);await combat.importState(value,{x:350,y:238});},
      onMode(mode){desktopArenaActive=mode==='arena';syncSimulationActivity();if(!desktopArenaActive)fetchStats();},
      onDamage(value){if(desktopArenaActive&&!pendingHits.length&&!sendingHits.length){confirmedDamage=value;state.totalDamage=value;document.getElementById('fk-damage-val').textContent=value.toLocaleString();}},
      onNavigate(tab){if(tab==='arena')selectSidebarModule('feedback');document.querySelector('.fk-ai-nav-btn[data-tab="'+tab+'"]').click();if(!state.isOpen)document.getElementById('fk-ai-float-btn').click();}
    });
  }

  async function fetchStats() {
    const revision=statsRevision, targetVersion=targetRevision, settingsVersion=settingsRevision;
    try {
      const res = await fetch("/fk-the-ai/api/stats");
      const data = await res.json();
      const previousTargets=state.config;
      state.config = data.config;
      if(targetVersion!==targetRevision&&previousTargets){state.config.presets=previousTargets.presets;state.config.activeTarget=previousTargets.activeTarget;}
      if(!settingsInitialized && settingsVersion===settingsRevision) {
        settings=normalizeSettings(data.config.combatSettings);settingsInitialized=true;
        combat.updateSettings(effectiveSettings());syncSettingsUI();
      }
      if (data.recentModel) {
        state.recentModelName = data.recentModel;
        combat.setModel(data.recentModel);
        const inp = document.getElementById("fk-input-model");
        if (inp && !state.customModelName) {
          inp.placeholder = data.recentModel;
        }
      }

      if(revision===statsRevision && !pendingHits.length && !sendingHits.length) {
        confirmedDamage=data.config.stats.totalDamageDealt||0;state.totalDamage=confirmedDamage;
        document.getElementById("fk-damage-val").innerText=state.totalDamage.toLocaleString();
      }

      document.getElementById("fk-ai-badge-cnt").innerText = data.scan.totalCurseCount || 0;
      document.getElementById("fk-stat-curses").innerText = data.scan.totalCurseCount || 0;
      document.getElementById("fk-stat-msgs").innerText = data.scan.totalUserMessages || 0;
      document.getElementById("fk-stat-files").innerText = data.scan.totalScannedFiles || 0;
      document.getElementById("fk-stat-words").innerText = data.config.customWords?.length || 0;

      const tbody = document.getElementById("fk-source-tbody");
      tbody.innerHTML = "";
      if (data.scan.sourceStats) {
        for (const s of data.scan.sourceStats) {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td style="font-weight: 700; color: var(--nl-text);">` + s.name + '</td>' +
            `<td style="font-family: var(--nl-mono); font-size: 11px;">` + s.path + '</td>' +
            `<td>` + s.filesCount + '</td>' +
            `<td>` + s.messagesCount + '</td>' +
            `<td style="color: var(--nl-accent-red); font-weight: 700;">` + s.cursesCount + '</td>';
          tbody.appendChild(tr);
        }
      }

      wordCloud.update(data.scan.rank||[]);
      settings.swearWords=(data.scan.rank||[]).map(({word,count})=>({word,count}));combat.updateSettings(effectiveSettings());

      renderTargets();
      if (targetVersion===targetRevision&&!targetBusy) {setTarget(data.config.activeTarget);renderTargets();}
    } catch (e) {}
  }

  function renderTargets() {
    const list=document.getElementById('fk-target-list');list.replaceChildren();
    for(const preset of state.config?.presets||[]) {
      const row=document.createElement('div');row.className='fk-ai-target-row';row.dataset.presetId=preset.id;
      const card=document.createElement('button');card.type='button';card.title=preset.name;card.disabled=targetBusy;
      card.className='fk-ai-target-card'+(state.target.id===preset.id?' active':'');
      const thumb=document.createElement('span');thumb.className='fk-ai-target-thumb';
      if(preset.avatar){const img=document.createElement('img');img.src=preset.avatar;img.alt='';thumb.append(img);}else thumb.textContent=preset.name.slice(0,2);
      const name=document.createElement('span');name.className='fk-ai-target-name';name.dataset.i18nSkip='';name.textContent=preset.name;
      card.append(thumb,name);card.onclick=()=>saveTarget(preset);
      const remove=document.createElement('button');remove.type='button';remove.className='fk-ai-target-delete';remove.textContent='×';remove.disabled=targetBusy;
      bindAttribute(remove,"aria-label",()=>i18nText("client.155")+preset.name);bindText(remove,()=>i18nText("client.156"), "title");
      remove.onclick=()=>requestTargetDeletion(preset);
      row.append(card,remove);list.append(row);
    }
    syncTargetEditor();
  }
  function requestTargetDeletion(preset) {
    if(targetBusy)return;
    let dialog=document.getElementById('fk-preset-delete-dialog');
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='fk-preset-delete-dialog';dialog.className='fk-part-dialog fk-preset-delete-dialog';
      dialog.setAttribute('aria-labelledby','fk-preset-delete-title');dialog.setAttribute('aria-describedby','fk-preset-delete-message');
      dialog.innerHTML=`<form><h3 id="fk-preset-delete-title">${i18nHtml('presets.deleteTitle')}</h3><p id="fk-preset-delete-message"></p><p id="fk-preset-delete-error" role="alert" hidden></p><div class="fk-part-dialog-actions"><button type="button" id="fk-preset-delete-cancel" autofocus>${i18nHtml('modeler.cancel')}</button><button type="submit" id="fk-preset-delete-confirm">${i18nHtml('presets.deleteConfirm')}</button></div></form>`;
      document.querySelector('.fk-ai-modal').append(dialog);
      let pending=null,submitting=false;
      bindText(dialog.querySelector('p'),()=>i18nText('presets.deleteMessage',{name:pending?.name||''}));
      const error=dialog.querySelector('#fk-preset-delete-error');
      dialog.openFor=value=>{if(dialog.open||submitting)return;pending={id:value.id,name:value.name};error.hidden=true;error.textContent='';bindText(dialog.querySelector('p'),()=>i18nText('presets.deleteMessage',{name:pending?.name||''}));dialog.showModal();dialog.querySelector('#fk-preset-delete-cancel').focus();};
      dialog.querySelector('#fk-preset-delete-cancel').onclick=()=>{if(!submitting)dialog.close();};
      dialog.addEventListener('cancel',e=>{if(submitting)e.preventDefault();});
      dialog.addEventListener('click',e=>{if(e.target!==dialog||submitting)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
      dialog.addEventListener('close',()=>{const id=pending?.id;pending=null;const row=[...document.querySelectorAll('[data-preset-id]')].find(row=>row.dataset.presetId===id);(row?.querySelector('.fk-ai-target-delete')||document.getElementById('fk-target-name')).focus();});
      dialog.querySelector('form').onsubmit=async e=>{
        e.preventDefault();if(!pending||submitting||targetBusy)return;
        submitting=true;error.hidden=true;for(const button of dialog.querySelectorAll('button'))button.disabled=true;
        try{if(await targetOperation('/presets','DELETE',{id:pending.id}))dialog.close();else{bindText(error,()=>targetStatus);error.hidden=false;}}
        finally{submitting=false;for(const button of dialog.querySelectorAll('button'))button.disabled=false;}
      };
    }
    dialog.openFor(preset);
  }
  async function targetOperation(route,method,payload) {
    if(targetBusy)return false;
    targetBusy=true;targetRevision++;targetStatus='';renderTargets();
    document.querySelector('#fk-target-form button').disabled=true;
    try {
      const res=await fetch('/fk-the-ai/api'+route,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const data=await res.json();if(!res.ok)throw new Error(data.error||i18nText("client.157"));
      if(!state.config)state.config={};
      if(data.presets)state.config.presets=data.presets;
      state.config.activeTarget=data.activeTarget;setTarget(data.activeTarget);
      return true;
    }catch(error){targetStatus=error.message;setTarget(state.config?.activeTarget||null);return false;}
    finally{targetBusy=false;targetRevision++;renderTargets();document.querySelector('#fk-target-form button').disabled=false;showSaveStatus();}
  }
  async function uploadAvatar(file) {
    if(targetBusy||!file)return;
    try {
      if(!file.type.startsWith('image/')||file.size>12*1024*1024)throw new Error(i18nText("client.158"));
      const bitmap=await createImageBitmap(file),size=256;
      const imageCanvas=document.createElement('canvas');imageCanvas.width=imageCanvas.height=size;
      const c=imageCanvas.getContext('2d'),side=Math.min(bitmap.width,bitmap.height);
      c.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size,size);bitmap.close();
      const input=document.getElementById('fk-target-name');
      if(await targetOperation('/presets','POST',{name:input.value.trim()||i18nText("client.159"),avatar:imageCanvas.toDataURL('image/png')}))input.value='';
    }catch(error){targetStatus=error.message;showSaveStatus();}
    document.getElementById('fk-file-selector').value='';
  }
  async function saveTarget(target) {
    if(targetBusy)return;
    setTarget(target);renderTargets();
    return targetOperation('/target','POST',{id:target.id});
  }

  function mountTargetEditor() {
    const editor=document.createElement('details');editor.className='fk-ai-target-editor';editor.id='fk-target-editor';
    editor.innerHTML=`<summary>${i18nHtml("client.161")}</summary><form id="fk-target-edit-form" class="fk-ai-target-form"><input id="fk-target-edit-name" class="fk-ai-input-text" aria-label="${i18nHtml("client.160")}" maxlength="60"><button type="submit" class="fk-ai-btn-action">${i18nHtml("client.162")}</button></form>`+
      `<select id="fk-texture-part" aria-label="${i18nHtml("client.163")}" hidden></select><section class="fk-model-sidebar"><header class="fk-model-sidebar-head"><strong>${i18nHtml('modeler.layers')}</strong><div class="fk-layer-actions"><button type="button" id="fk-part-add" title="${i18nHtml('client.179')}" aria-label="${i18nHtml('client.179')}">${modelIcon('add')}</button><button type="button" id="fk-group-add" title="${i18nHtml('modeler.newGroup')}" aria-label="${i18nHtml('modeler.newGroup')}">${modelIcon('groupAdd')}</button></div></header><div class="fk-layer-tree" id="fk-layer-tree" role="tree"></div><small class="fk-ai-editor-hint">${i18nHtml('modeler.layerHint')}</small><div class="fk-model-properties"><header class="fk-inspector-head"><h3>${i18nHtml('modeler.properties')}</h3><span id="fk-inspector-context">${i18nHtml('modeler.partInspector')}</span></header><div id="fk-part-properties"><form id="fk-part-form"><label class="fk-part-name-field">${i18nHtml("modeler.partName")}<input class="fk-ai-input-text" id="fk-part-name" aria-label="${i18nHtml("modeler.partName")}" maxlength="40" required></label><fieldset class="fk-inspector-section"><legend>${i18nHtml('modeler.transform')}</legend><div class="fk-inspector-grid">`+[['width',i18nText("client.169"),6,null],['height',i18nText("client.170"),6,null],['x',i18nText("client.171"),null,null],['y',i18nText("client.172"),null,null],['rotation',i18nText('modeler.rotation'),-360,360]].map(([id,label,min,max])=>`<label>${label}<input class="fk-ai-input-text" id="fk-part-${id}" aria-label="${i18nHtml("client.173", {v0: label})}" type="number" ${min===null?'':`min="${min}"`} ${max===null?'':`max="${max}"`} step="any" required></label>`).join('')+`</div></fieldset><fieldset class="fk-inspector-section"><legend>${i18nHtml('modeler.appearance')}</legend><div class="fk-inspector-grid"><label class="fk-ai-control-row fk-part-full"><span>${i18nHtml('modeler.opacity')}</span><input id="fk-part-opacity" type="range" min="0" max="100" value="100"><output id="fk-part-opacity-value">100%</output></label><label class="fk-ai-control-row"><input id="fk-part-flipX" type="checkbox"><span>${i18nHtml('modeler.flipX')}</span></label><label class="fk-ai-control-row"><input id="fk-part-flipY" type="checkbox"><span>${i18nHtml('modeler.flipY')}</span></label><label class="fk-ai-control-row fk-part-full"><input id="fk-part-visible" type="checkbox"><span>${i18nHtml('modeler.visible')}</span></label></div></fieldset><fieldset class="fk-inspector-section"><legend>${i18nHtml('modeler.boneBinding')}</legend><label>${i18nHtml('modeler.boneBinding')}<select id="fk-part-bone" aria-label="${i18nHtml('modeler.boneBinding')}"></select></label></fieldset><div class="fk-inspector-actions"><button class="fk-ai-btn-action" type="submit">${i18nHtml("client.176")}</button><button type="button" id="fk-part-crop-reset">${i18nHtml('modeler.cropReset')}</button><button type="button" id="fk-part-remove">${i18nHtml('modeler.delete')}</button></div></form></div><div id="fk-group-properties" hidden><form id="fk-group-form"><label>${i18nHtml('modeler.groupName')}<input class="fk-ai-input-text" id="fk-group-name" maxlength="40" required></label><button type="submit">${i18nHtml('modeler.saveGroup')}</button></form><p id="fk-group-info" class="fk-ai-editor-hint"></p><button type="button" id="fk-group-ungroup">${i18nHtml('modeler.deleteGroup')}</button></div></div></section>`+
      `<div id="fk-part-assets"><label class="fk-ai-editor-label">${i18nHtml('modeler.material')}</label><div class="fk-ai-skin-preview"><img id="fk-texture-preview" alt="${i18nHtml("client.164")}" hidden><span id="fk-texture-label">${i18nHtml("client.165")}</span></div>`+
      `<div class="fk-ai-texture-tools"><button type="button" id="fk-texture-upload">${i18nHtml("client.166")}</button><button type="button" id="fk-texture-reset">${i18nHtml("client.167")}</button><input id="fk-texture-file" type="file" accept="image/*" hidden></div><small class="fk-ai-editor-hint">${i18nHtml("client.168")}</small>`+
      `<label class="fk-ai-editor-label">${i18nHtml("client.182")}</label><label class="fk-ai-control-row"><span>${i18nHtml("client.181")}</span><input class="fk-ai-input-text" id="fk-sequence-fps" aria-label="${i18nHtml("client.181")}" type="number" min="1" max="30" value="8" style="width:70px"></label><div class="fk-ai-texture-tools"><button type="button" id="fk-sequence-upload">${i18nHtml("client.183")}</button><button type="button" id="fk-sequence-reset">${i18nHtml("client.184")}</button><input id="fk-sequence-file" type="file" multiple accept="image/png,image/webp,image/jpeg" hidden></div><small id="fk-sequence-label" class="fk-ai-editor-hint">${i18nHtml("client.185")}</small></div>`;
    editor.querySelector('#fk-part-properties').append(editor.querySelector('#fk-part-assets'));
    document.querySelector('.fk-ai-fx-controls').before(editor);
    const dialog=document.createElement('dialog');dialog.id='fk-part-dialog';dialog.className='fk-part-dialog';
    dialog.innerHTML=`<form id="fk-part-add-form"><h3>${i18nHtml('modeler.addPartTitle')}</h3><label for="fk-part-new-name">${i18nHtml('modeler.partName')}</label><input class="fk-ai-input-text" id="fk-part-new-name" aria-label="${i18nHtml('client.177')}" maxlength="40" placeholder="${i18nHtml('client.178')}" required autofocus><div class="fk-part-dialog-actions"><button type="button" id="fk-part-add-cancel">${i18nHtml('modeler.cancel')}</button><button type="submit" id="fk-part-add-confirm">${i18nHtml('modeler.addPartConfirm')}</button></div></form>`;
    document.querySelector('.fk-ai-modal').append(dialog);
    let addingTarget='',addingLayer=null;
    document.getElementById('fk-part-add-cancel').onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
    dialog.addEventListener('close',()=>{document.getElementById('fk-part-add').focus();});

    document.getElementById('fk-target-edit-form').onsubmit=async e=>{e.preventDefault();if(state.target.id)await targetOperation('/presets','PATCH',{id:state.target.id,name:document.getElementById('fk-target-edit-name').value});};
    document.getElementById('fk-texture-part').onchange=()=>{imageUploadRevision++;modeler?.selectPart(document.getElementById('fk-texture-part').value);syncTargetEditor();};
    document.getElementById('fk-texture-upload').onclick=()=>document.getElementById('fk-texture-file').click();
    document.getElementById('fk-texture-reset').onclick=()=>{imageUploadRevision++;const id=document.getElementById('fk-texture-part').value;modeler?.edit(d=>{delete d.textures[id];});};
    document.getElementById('fk-texture-file').onchange=async e=>{
      const id=state.target.id,part=document.getElementById('fk-texture-part').value,revision=++imageUploadRevision;
      try {const file=e.target.files?.[0];if(!file||!id)return;const texture=await encodeTexture(file,512);
        if(revision!==imageUploadRevision||state.target.id!==id)return;
        await modeler?.edit(d=>{d.textures[part]=texture;});
      }catch(error){targetStatus=error.message;showSaveStatus();}finally{e.target.value='';}
    };
    const current=()=>state.config?.presets?.find(p=>p.id===state.target.id);
    document.getElementById('fk-part-form').onsubmit=async e=>{
      e.preventDefault();const preset=current();if(!preset)return;
      const nameInput=document.getElementById('fk-part-name');nameInput.value=nameInput.value.trim();if(!e.target.reportValidity())return;
      const part=document.getElementById('fk-texture-part').value,rig=normalizeRig(preset.rig).map(p=>p.id!==part?p:{...p,...Object.fromEntries(['width','height','x','y','rotation'].map(key=>[key,Number(document.getElementById('fk-part-'+key).value)])),opacity:Number(document.getElementById('fk-part-opacity').value)/100,flipX:document.getElementById('fk-part-flipX').checked,flipY:document.getElementById('fk-part-flipY').checked,visible:document.getElementById('fk-part-visible').checked,name:document.getElementById('fk-part-name').value.trim(),bone:document.getElementById('fk-part-bone').value||null});
      await modeler?.patchPart(part,rig.find(p=>p.id===part));
    };
    document.getElementById('fk-part-add').onclick=()=>{
      const preset=current();if(!preset||targetBusy)return;addingTarget=preset.id;addingLayer=modeler?.getSelection().id||null;
      document.getElementById('fk-part-new-name').value='';dialog.showModal();
    };
    document.getElementById('fk-part-add-form').onsubmit=async e=>{
      e.preventDefault();const preset=current(),input=document.getElementById('fk-part-new-name'),name=input.value.trim();
      input.value=name;if(!e.target.reportValidity())return;
      if(!preset||preset.id!==addingTarget||targetBusy||!name)return;
      const confirm=document.getElementById('fk-part-add-confirm');confirm.disabled=true;
      try{if(await modeler?.addPart(name,addingLayer)){syncTargetEditor();dialog.close();}}finally{confirm.disabled=false;}
    };
    document.getElementById('fk-part-remove').onclick=()=>modeler?.remove();
    document.getElementById('fk-part-crop-reset').onclick=()=>modeler?.resetCrop(document.getElementById('fk-texture-part').value);
    document.getElementById('fk-part-opacity').oninput=e=>{document.getElementById('fk-part-opacity-value').value=e.target.value+'%';};
    document.getElementById('fk-part-opacity').onchange=()=>{const preset=current(),id=document.getElementById('fk-texture-part').value;if(preset)modeler?.patchPart(id,{opacity:Number(document.getElementById('fk-part-opacity').value)/100});};
    for(const id of ['fk-part-flipX','fk-part-flipY','fk-part-visible'])document.getElementById(id).onchange=()=>{const part=document.getElementById('fk-texture-part').value,patch={[id.slice(9)]:document.getElementById(id).checked};modeler?.patchPart(part,patch);};
    document.getElementById('fk-sequence-upload').onclick=()=>document.getElementById('fk-sequence-file').click();
    document.getElementById('fk-sequence-file').onchange=async e=>{
      const preset=current(),part=document.getElementById('fk-texture-part').value,revision=++imageUploadRevision;
      try {const files=[...e.target.files].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));if(!files.length||!preset)return;if(files.length>24)throw new Error(i18nText("client.187"));
        const frames=[];for(const f of files)frames.push(await encodeTexture(f,512));if(revision!==imageUploadRevision||state.target.id!==preset.id)return;
        await modeler?.edit(d=>{d.sequences[part]={frames,fps:Number(document.getElementById('fk-sequence-fps').value)};});
      }catch(error){targetStatus=error.message;showSaveStatus();}finally{e.target.value='';}
    };
    document.getElementById('fk-sequence-reset').onclick=async()=>{imageUploadRevision++;const preset=current();if(!preset)return;const id=document.getElementById('fk-texture-part').value;await modeler?.edit(d=>{delete d.sequences[id];});};
    document.getElementById('fk-sequence-fps').onchange=async e=>{const preset=current(),part=document.getElementById('fk-texture-part').value;if(preset?.sequences?.[part])await modeler?.edit(d=>{d.sequences[part].fps=Number(e.target.value);});};
    syncTargetEditor();
  }
  function syncTargetEditor() {
    const editor=document.getElementById('fk-target-editor');if(!editor)return;
    const preset=state.config?.presets?.find(p=>p.id===state.target.id);
    for(const el of editor.querySelectorAll('button,input,select'))el.disabled=targetBusy||!preset;
    const name=document.getElementById('fk-target-edit-name');
    if(document.activeElement!==name)name.value=preset?.name||'';
    const rig=normalizeRig(preset?.rig),select=document.getElementById('fk-texture-part'),selected=select.value;
    select.replaceChildren(...rig.map(p=>new Option(p.name,p.id)));if(rig.some(p=>p.id===selected))select.value=selected;
    const part=select.value,definition=rig.find(p=>p.id===part)||rig[0],texture=preset?.sequences?.[part]?.frames[0]||preset?.textures?.[part]||(part==='head'?preset?.avatar:'');
    for(const key of ['name','width','height','x','y','rotation']){const input=document.getElementById('fk-part-'+key);if(document.activeElement!==input)input.value=definition[key];}
    for(const [key,value] of [['opacity',Math.round((definition.opacity??1)*100)],['flipX',definition.flipX??false],['flipY',definition.flipY??false],['visible',definition.visible??true]]){const input=document.getElementById('fk-part-'+key);if(document.activeElement!==input)input.type==='checkbox'?input.checked=value:input.value=value;}document.getElementById('fk-part-opacity-value').value=Math.round((definition.opacity??1)*100)+'%';
    const binding=document.getElementById('fk-part-bone');binding.replaceChildren(new Option(i18nText('modeler.boneNone'),''),...(preset?.bones||[]).map(b=>new Option(b.name,b.id)));binding.value=definition.bone||'';
    document.getElementById('fk-part-remove').disabled=targetBusy||!preset||rig.length===1;
    document.getElementById('fk-part-add').disabled=targetBusy||!preset||rig.length>=24;
    const sequence=preset?.sequences?.[part];document.getElementById('fk-sequence-fps').value=sequence?.fps||8;
    bindText(document.getElementById('fk-sequence-label'),()=>sequence?i18nText("client.189", {v0: sequence.frames.length, v1: sequence.fps}):i18nText("client.185"), "textContent");
    const preview=document.getElementById('fk-texture-preview');preview.hidden=!texture;
    if(texture)preview.src=texture;else preview.removeAttribute('src');
    bindText(document.getElementById('fk-texture-label'),()=>preset?(preset.sequences?.[part]?i18nText("client.190"):preset.textures?.[part]?i18nText("client.191"):i18nText("client.165")):i18nText("client.192"), "textContent");
    if(!targetBusy)modeler?.setPreset(preset);
  }
  async function encodeTexture(file,maxSize) {
    if(!file.type.startsWith('image/')||file.size>12*1024*1024)throw new Error(i18nText("client.158"));
    const bitmap=await createImageBitmap(file);
    try {
      const ratio=Math.min(1,maxSize/Math.max(bitmap.width,bitmap.height));
      const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*ratio));c.height=Math.max(1,Math.round(bitmap.height*ratio));
      c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);
      const data=c.toDataURL('image/png');if(!validTexture(data))throw new Error(i18nText("client.193"));return data;
    }finally{bitmap.close();}
  }
  function setTarget(t) {
    combat?.setDialogueOwner(t?.id||'');
    dialogueEditor?.sync();combat?.updateSettings(effectiveSettings());
    const revisionKey=t?JSON.stringify([t.id,t.name,t.avatar,t.textures,t.rig,t.groups,t.layers,t.bones,t.sequences]):'';
    if(!t){targetImageRevision++;targetImageKey='';state.target={id:null,name:'',avatarImg:null};combat.setTarget(null);combat.setTargetEnabled(false);petReady=true;pet?.setTarget(null);syncRopeControls();return;}
    const changed=state.target.id!==t.id;
    combat.setTargetEnabled(true);if(changed)combat.reset();
    state.target.id=t.id;state.target.name=t.name;dialogueEditor?.sync();combat.updateSettings(effectiveSettings());
    if(revisionKey===targetImageKey)return;
    petReady=false;targetImageKey=revisionKey;const revision=++targetImageRevision;
    if(changed)combat.setTarget(null);
    loadPuppetImages(t).then(({rig,avatar,skins,sequences})=>{
      if(revision!==targetImageRevision)return;
      state.target.avatarImg=avatar;syncRopeControls();combat.setRig(rig);combat.setTarget(avatar,skins,sequences);petReady=true;pet?.setTarget({id:t.id,name:t.name,rig,groups:t.groups||[],avatar,skins,sequences});
    }).catch(error=>{targetStatus=error.message;showSaveStatus();});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountUI);
  } else {
    mountUI();
  }
})();
