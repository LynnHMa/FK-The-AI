import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");

export function getRecentModelName() {
  // 1. 从 session_projcache 读取最近一次选中的模型
  try {
    const projDir = path.join(DSH_HOME, "storages", "session_projcache", "sessions");
    if (fs.existsSync(projDir)) {
      const files = fs.readdirSync(projDir).filter(f => f.endsWith(".json"));
      for (const f of files) {
        const full = path.join(projDir, f);
        const data = JSON.parse(fs.readFileSync(full, "utf8"));
        const model = data.record?.rows?.modelSelection?.val?.lastUsed?.model
                   || data.record?.rows?.modelSelection?.val?.pending?.model;
        if (model) return String(model);
      }
    }
  } catch (e) {}

  // 2. 从 cordis.patch.yml 读取默认配置
  try {
    const patchFile = path.join(DSH_HOME, "profiles", "desktop", "cordis.patch.yml");
    if (fs.existsSync(patchFile)) {
      const text = fs.readFileSync(patchFile, "utf8");
      const match = text.match(/model:\s*([^\r\n]+)/);
      if (match && match[1]) return match[1].trim();
    }
  } catch (e) {}

  return "deepseek-flash";
}
