import {loadLanguageFiles,getCatalogs,setLanguage,getLanguageRevision,locales} from '../assets/i18n.js';
import {t as i18nText,onLanguageChange,getLanguage} from '../assets/i18n.js';
import { getRecentModelName } from "./model_detector.js";
// ============================================================================
// FK The AI - DSH 插件宿主入口 (Cordis Plugin)
// 适配 DeepSeek Harness Desktop (Electron) & Web 架构
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanMultiAgentSessions } from "./scanner.js";
import { loadConfig, saveConfig, PET_SESSION_FILE } from "./store.js";
import { loadDictionaryFromFile } from "./lexicon.js";
import { normalizeSettings, WEAPONS } from '../assets/combat.js';
import { applyBeatBatch } from './combat-stats.js';
import { addTarget, deleteTarget, updateTarget, importTargets } from './targets.js';
import { MAX_BUNDLE_LENGTH } from '../assets/puppet.js';
import { createDesktopPet } from './desktop-pet.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DESKTOP_INJECT_SNIPPET =
  "(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;" +
  "var s=document.createElement(\"script\");s.src=\"/fk-the-ai/client.js\";" +
  "s.onerror=function(){};d.appendChild(s)}catch(e){}})()";

export default {
  name: "dsh-fk-the-ai",

  apply(root) {
    const rowDisposers = [];
    root.effect(() => () => {
      for (const d of rowDisposers) {
        try { d(); } catch (e) {}
      }
    });

    rowDisposers.push(
      root.on("webserver/index-inject", (table) => {
        try {
          if (!Array.isArray(table)) return;
          for (const row of table) {
            if (!row) continue;
            if (row.kind === "script" && typeof row.text === "string" && row.text.indexOf("/fk-the-ai/client.js") >= 0) {
              return;
            }
          }
          table.push({ kind: "script", placement: "body", text: DESKTOP_INJECT_SNIPPET });
        } catch (err) {}
      })
    );

    root.inject(["webServer"], (ctx) => {
      const disposers = [];
      const languageDirectory=path.join(PACKAGE_ROOT,'lang');
      const configuredLocale=loadConfig().language;
      if(locales.includes(configuredLocale))setLanguage(getCatalogs(),configuredLocale);
      const languageClients=new Set();
      let languageTimer=0;
      const languageWatcher=fs.watch(languageDirectory,{persistent:false},(_event,filename)=>{
        if(filename&&!/^((zh_CN)|(en))\.yml$/i.test(String(filename)))return;
        clearTimeout(languageTimer);
        languageTimer=setTimeout(async()=>{
          try {
            await loadLanguageFiles(languageDirectory);
            const event='event: language-change\ndata: '+getLanguageRevision()+'\n\n';
            for(const client of languageClients){try{client.write(event);}catch{languageClients.delete(client);}}
          } catch(error) { console.warn('[FK The AI] language:',error.message); }
        },120);
      });
      disposers.push(()=>{clearTimeout(languageTimer);languageWatcher.close();for(const client of languageClients)client.end();languageClients.clear();});
      disposers.push(ctx.webServer.register({
        kind:'exact',path:'/fk-the-ai/api/lang-events',
        handler(req,res){
          if(req.method!=='GET'){res.writeHead(405);return res.end();}
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
          res.write('retry: 1500\n\n');languageClients.add(res);
          const remove=()=>languageClients.delete(res);req.once('close',remove);res.once('close',remove);
        }
      }));
      for(const locale of ['zh_CN','en'])disposers.push(ctx.webServer.register({
        kind:'exact',path:'/fk-the-ai/lang/'+locale+'.yml',
        handler(req,res){try{res.writeHead(200,{'Content-Type':'text/yaml; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(languageDirectory,locale+'.yml'),'utf8'));}catch(error){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end(error.message);}}
      }));
      disposers.push(ctx.webServer.register({
        kind:'exact',path:'/fk-the-ai/api/language',
        async handler(req,res){
          try {
            if(req.method==='POST') {
              if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)){res.writeHead(403);return res.end();}
              let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw new Error(i18nText("error.languageRequest"));}
              const {locale}=JSON.parse(body||'{}');if(!locales.includes(locale))throw new Error(i18nText("error.locale"));
              const cfg=loadConfig();cfg.language=locale;if(!saveConfig(cfg))throw new Error(i18nText("error.saveLanguage"));
              setLanguage(getCatalogs(),locale);
              for(const client of languageClients)client.write('event: language-change\ndata: '+getLanguageRevision()+'\n\n');
            }else if(req.method!=='GET'){res.writeHead(405);return res.end();}
            const etag='"'+getLanguageRevision()+'"';
            if(req.method==='GET'&&req.headers['if-none-match']===etag){res.writeHead(304,{'ETag':etag});return res.end();}
            res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','ETag':etag});
            res.end(JSON.stringify({locale:getLanguage(),catalogs:getCatalogs(),revision:getLanguageRevision()}));
          }catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:error.message}));}
        }
      }));
      let latestSwearWords=[];
      const desktopPet=createDesktopPet({
        sessionPath:PET_SESSION_FILE,
        getConfig:loadConfig,
        getSwearWords:()=>latestSwearWords,
        recordHits(hits){const cfg=loadConfig();const result=applyBeatBatch(cfg.stats,{hits});cfg.stats=result.stats;if(!saveConfig(cfg))throw new Error(i18nText("index.002"));return cfg.stats;},
        onGravity(gravity){const cfg=loadConfig();cfg.combatSettings.pet.gravity=gravity;if(!saveConfig(cfg))throw new Error(i18nText("index.003"));}
      });
      const stopLanguageSync=onLanguageChange(()=>desktopPet.update({}).catch(error=>console.warn('[FK The AI] language:',error.message)));
      disposers.push(stopLanguageSync);
      desktopPet.restore().catch(error=>console.error(i18nText("index.004"),error.message));
      const savePetOnExit=()=>desktopPet.snapshotSession();process.once('exit',savePetOnExit);
      disposers.push(()=>desktopPet.close({remember:false}).catch(()=>{}).finally(()=>process.removeListener('exit',savePetOnExit)));
      for(const action of ['status','open','state','close','arena','exit-arena'])disposers.push(ctx.webServer.register({
        kind:'exact',path:'/fk-the-ai/api/pet/'+action,
        async handler(req,res){
          try {
            if(action!=='status'&&req.method!=='POST'){res.writeHead(405);return res.end();}
            if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)){res.writeHead(403);return res.end();}
            let input={};if(action==='state'){let body='';for await(const chunk of req){body+=chunk;if(body.length>10000000)throw new Error(i18nText("index.005"));}input=JSON.parse(body||'{}');}
            const result=action==='status'?desktopPet.status():action==='state'?await desktopPet.update(input):action==='open'?await desktopPet.open():action==='arena'?await desktopPet.startArena():action==='exit-arena'?await desktopPet.stopArena():await desktopPet.close();
            res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
          }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
        }
      }));
      for(const file of ['i18n.js','weapon-values.js','window-layout.js','puppet.js','pet.js','modeler.js','word-cloud.js','weapons.js','dialogue.js','weapon-editor.js','dialogue-editor.js','weapon-graph.js','weapon-runtime.js'])disposers.push(ctx.webServer.register({
        kind:'exact',path:'/fk-the-ai/'+file,
        handler(req,res){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(PACKAGE_ROOT,'assets',file),'utf8'));}
      }));
      function registerRoute(route) {
        return ctx.webServer.register(route);
      }

      disposers.push(registerRoute({
        kind: 'exact', path: '/fk-the-ai/combat.js',
        handler(req,res) {
          res.writeHead(200, {'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});
          res.end(fs.readFileSync(path.join(PACKAGE_ROOT,'assets','combat.js'),'utf8'));
        }
      }));
      disposers.push(registerRoute({
        kind:'exact',path:'/fk-the-ai/themes.js',
        handler(req,res){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(PACKAGE_ROOT,'assets','themes.js'),'utf8'));}
      }));
      disposers.push(registerRoute({
        kind:'exact',path:'/fk-the-ai/api/combat-settings',
        async handler(req,res) {
          if(req.method!=='POST'){res.writeHead(405);return res.end();}
          try {
            let body='';for await(const chunk of req){body+=chunk;if(body.length>24000000)throw new Error(i18nText("index.006"));}
            const config=loadConfig();config.combatSettings=normalizeSettings(JSON.parse(body||'{}'));
            if(!saveConfig(config))throw new Error(i18nText("error.saveSettings"));
            res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({settings:config.combatSettings}));
          }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
        }
      }));

      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/client.js",
          handler: (req, res) => {
            try {
              const p = path.join(PACKAGE_ROOT, "assets", "client.js");
              res.writeHead(200, {
                "Content-Type": "application/javascript; charset=utf-8",
                "Cache-Control": "no-store"
              });
              res.end(fs.readFileSync(p, "utf8"));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end(e.message);
            }
          }
        })
      );

      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/client.css",
          handler: (req, res) => {
            try {
              const p = path.join(PACKAGE_ROOT, "assets", "client.css");
              res.writeHead(200, {
                "Content-Type": "text/css; charset=utf-8",
                "Cache-Control": "no-store"
              });
              res.end(fs.readFileSync(p, "utf8"));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end(e.message);
            }
          }
        })
      );

      disposers.push(
        ctx.webServer.tapIndex((html) => {
          if (html.indexOf("/fk-the-ai/client.js") !== -1) return html;
          const tag = `<script defer src="/fk-the-ai/client.js"></script>`;
          if (html.indexOf("</body>") !== -1) return html.replace("</body>", tag + "</body>");
          return html + tag;
        })
      );

      // API: 全量扫描 (GET /fk-the-ai/api/stats)
      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/api/stats",
          handler: (req, res) => {
            try {
              const cfg = loadConfig();
              const scan = scanMultiAgentSessions(cfg.agentSources, cfg.customWords);
              latestSwearWords=scan.rank||[];
              res.writeHead(200, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
              });
              const recentModel = getRecentModelName();
              res.end(JSON.stringify({ config: cfg, scan, recentModel }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: e.message }));
            }
          }
        })
      );

      // API: 添加/更新 Agent 目录源 (POST /fk-the-ai/api/sources)
      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/api/sources",
          handler: async (req, res) => {
            try {
              let body = "";
              for await (const chunk of req) body += chunk;
              const source = JSON.parse(body || "{}");
              if (!source.name || !source.path) {
                res.writeHead(400, { "Content-Type": "application/json" });
                return res.end(JSON.stringify({ error: i18nText("error.source") }));
              }

              const cfg = loadConfig();
              const idx = cfg.agentSources.findIndex((s) => s.id === source.id);
              if (idx >= 0) {
                cfg.agentSources[idx] = { ...cfg.agentSources[idx], ...source };
              } else {
                cfg.agentSources.push({
                  id: source.id || "src_" + Date.now(),
                  name: source.name,
                  type: source.type || "codex",
                  path: source.path,
                  enabled: true
                });
              }
              saveConfig(cfg);

              res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ success: true, agentSources: cfg.agentSources }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: e.message }));
            }
          }
        })
      );

      // API: 导入本地外部词典文件 (POST /fk-the-ai/api/import-dict)
      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/api/import-dict",
          handler: async (req, res) => {
            try {
              let body = "";
              for await (const chunk of req) body += chunk;
              const { filePath, fileContent } = JSON.parse(body || "{}");

              let newWords = [];
              if (filePath) {
                newWords = loadDictionaryFromFile(filePath);
              } else if (fileContent) {
                // 直接传递的内容
                const lines = fileContent.split(/[\r\n,，]+/);
                for (const l of lines) {
                  const t = l.trim();
                  if (t && !t.startsWith("#") && !t.startsWith("//")) newWords.push(t);
                }
              }

              if (newWords.length === 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                return res.end(JSON.stringify({ error: i18nText("index.007") }));
              }

              const cfg = loadConfig();
              const existingMap = new Set(cfg.customWords.map(w => (typeof w === "string" ? w : w.word).toLowerCase()));
              let addedCount = 0;

              for (const nw of newWords) {
                if (!existingMap.has(nw.toLowerCase())) {
                  cfg.customWords.push({ word: nw, weight: 2, category: "imported" });
                  existingMap.add(nw.toLowerCase());
                  addedCount++;
                }
              }

              saveConfig(cfg);
              res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ success: true, addedCount, totalWords: cfg.customWords.length }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: e.message }));
            }
          }
        })
      );

      // API: 新增单个关键词 (POST /fk-the-ai/api/words)
      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/api/words",
          handler: async (req, res) => {
            try {
              let body = "";
              for await (const chunk of req) body += chunk;
              const { word } = JSON.parse(body || "{}");
              if (!word) {
                res.writeHead(400, { "Content-Type": "application/json" });
                return res.end(JSON.stringify({ error: i18nText("error.word") }));
              }

              const cfg = loadConfig();
              const exists = cfg.customWords.some((w) => (typeof w === "string" ? w : w.word) === word);
              if (!exists) {
                cfg.customWords.push({ word, weight: 2, category: "custom" });
                saveConfig(cfg);
              }

              res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ success: true, customWords: cfg.customWords }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: e.message }));
            }
          }
        })
      );

      disposers.push(registerRoute({
        kind:'exact',path:'/fk-the-ai/api/presets',
        async handler(req,res) {
          try {
            let cfg=loadConfig();
            if(req.method!=='GET') {
              if(!['POST','PATCH','DELETE'].includes(req.method)){res.writeHead(405);return res.end();}
              let body='';for await(const chunk of req){body+=chunk;if(body.length>MAX_BUNDLE_LENGTH)throw new Error(i18nText("index.008"));}
              const input=JSON.parse(body||'{}');
              cfg=req.method==='POST'?(input.presets?importTargets(cfg,input):addTarget(cfg,input)):req.method==='PATCH'?updateTarget(cfg,input):deleteTarget(cfg,input.id);
              if(!saveConfig(cfg))throw new Error(i18nText("client.157"));
            }
            res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
            res.end(JSON.stringify({presets:cfg.presets,activeTarget:cfg.activeTarget}));
          } catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:error.message}));}
        }
      }));
      // Selecting a preset never trusts a stale client copy of its avatar.
      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/api/target",
          handler: async (req, res) => {
            if(req.method!=='POST'){res.writeHead(405);return res.end();}
            try {
              let body = "";
              for await (const chunk of req) body += chunk;
              const target = JSON.parse(body || "{}");

              const cfg = loadConfig();
              const selected=cfg.presets.find(p=>p.id===target.id);
              if(!selected)throw new Error(i18nText("index.009"));
              cfg.activeTarget = selected;
              if(!saveConfig(cfg))throw new Error(i18nText("client.157"));

              res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ success: true, activeTarget: cfg.activeTarget }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: e.message }));
            }
          }
        })
      );

      // API: 击打发泄 (POST /fk-the-ai/api/beat)
      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/api/beat",
          handler: async (req, res) => {
            if(req.method!=='POST'){res.writeHead(405);return res.end();}
            try {
              let body = "";
              for await (const chunk of req) { body += chunk; if(body.length>64000)throw new Error(i18nText("error.payload")); }
              const payload=JSON.parse(body || '{}');

              const cfg = loadConfig();
              // Compatibility for an already-open client from the previous runtime.
              if(!payload.hits) {
                if(!Number.isSafeInteger(payload.damageDealt)||payload.damageDealt<1||payload.damageDealt>100000)throw new Error(i18nText("error.damage"));
                payload.hits=[{id:'legacy:'+Date.now()+':'+Math.random(),weapon:Object.hasOwn(WEAPONS,payload.weapon)?payload.weapon:'fist',damage:payload.damageDealt,combo:payload.combo}];
              }
              const result=applyBeatBatch(cfg.stats,payload);cfg.stats=result.stats;
              if(!saveConfig(cfg))throw new Error(i18nText("error.saveDamage"));

              res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ success: true, stats: cfg.stats }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: e.message }));
            }
          }
        })
      );

      
      // API: 重置累计造成的伤害量
      disposers.push(
        registerRoute({
          kind: "exact",
          path: "/fk-the-ai/api/reset-damage",
          handler: (req, res) => {
            if(req.method!=='POST'){res.writeHead(405);return res.end();}
            try {
              const cfg = loadConfig();
              cfg.stats.totalDamageDealt = 0;
              cfg.stats.currentCombo = 0;
              if(!saveConfig(cfg))throw new Error(i18nText("error.resetDamage"));
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: e.message }));
            }
          }
        })
      );
    ctx.effect(() => () => {
        for (const d of disposers) {
          try { d(); } catch (e) {}
        }
      });
    });
  }
};

