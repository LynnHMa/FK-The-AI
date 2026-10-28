import {t as i18nText} from '../assets/i18n.js';
// ============================================================================
// FK The AI - 本地持久化与配置管理 (SSOT 存储中心)
// 保存于 $DSH_HOME/fk-the-ai-config.json
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_SWEAR_WORDS } from "./lexicon.js";
import { normalizeSettings } from '../assets/combat.js';
import { DEFAULT_AI, migrateTargets } from './targets.js';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const CONFIG_FILE = path.join(DSH_HOME, "fk-the-ai-config.json");
export const PET_SESSION_FILE = path.join(DSH_HOME, 'fk-the-ai-pet-session.json');

const DEFAULT_CONFIG = {
  // 监控目录源: 默认包含 DSH 与 Codex (用户可动态添加 Claude Code, Cursor 等)
  agentSources: [
    {
      id: "dsh",
      name: "DeepSeek Harness",
      type: "dsh",
      path: path.join(DSH_HOME, "sessions"),
      enabled: true
    },
    {
      id: "codex",
      name: "OpenAI Codex CLI / App",
      type: "codex",
      path: path.join(os.homedir(), ".codex", "sessions"),
      enabled: true
    }
  ],
  // 脏话关键词库
  customWords: DEFAULT_SWEAR_WORDS,
  // 累计发泄数据
  stats: {
    totalDamageDealt: 0,
    totalBeats: 0,
    currentCombo: 0,
    maxCombo: 0,
    lastBeatenAt: null
  },
  activeTarget: DEFAULT_AI,
  presets: [DEFAULT_AI],
  targetSchemaVersion: 4
};

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return {
        ...DEFAULT_CONFIG,
        ...data,
        agentSources: data.agentSources || DEFAULT_CONFIG.agentSources,
        stats: { ...DEFAULT_CONFIG.stats, ...(data.stats || {}) },
        combatSettings: normalizeSettings({...data.combatSettings,flash:data.combatSettings?.schemaVersion>=2?data.combatSettings.flash:false}),
        ...migrateTargets(data)
      };
    }
  } catch (err) {
    console.error(i18nText("store.load"), err);
  }
  const defaults=structuredClone(DEFAULT_CONFIG);
  return { ...defaults, ...migrateTargets(defaults), combatSettings: normalizeSettings() };
}

export function saveConfig(cfg) {
  try {
    fs.mkdirSync(DSH_HOME, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error(i18nText("store.save"), err);
    return false;
  }
}

