// ============================================================================
// FK The AI - 智能多 Agent 会话全量扫描引擎 (带代码/URL/路径/标签智能脱敏与全词边界匹配)
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * 文本智能脱敏净化: 过滤掉代码块、行内变量、URL、系统指令标签等技术噪声
 */
export function sanitizeUserText(text) {
  if (!text || typeof text !== "string") return "";

  // 1. 过滤系统指令提示词块
  if (text.includes("<INSTRUCTIONS>") && text.includes("</INSTRUCTIONS>")) {
    const parts = text.split("</INSTRUCTIONS>");
    text = parts[parts.length - 1];
  }

  // 2. 过滤多行代码块 ```...```
  text = text.replace(/```[\s\S]*?```/g, " ");

  // 3. 过滤单行行内代码 `...`
  text = text.replace(/`[^`]*?`/g, " ");

  // 4. 过滤 URL / 链接 (http://, https://, file://, git://)
  text = text.replace(/https?:\/\/[^\s]+/g, " ");
  text = text.replace(/file:\/\/[^\s]+/g, " ");
  text = text.replace(/git:\/\/[^\s]+/g, " ");

  // 5. 过滤 Windows/Unix 文件路径 (如 C:\xxx\yyy 或 /usr/bin/xxx)
  text = text.replace(/[A-Za-z]:\\[^\s]+/g, " ");
  text = text.replace(/(?:^|\s)\/[a-zA-Z0-9_.\-]+(?:\/[a-zA-Z0-9_.\-]+)+/g, " ");

  // 6. 过滤 XML/HTML 标签 (如 <image...>, <INSTRUCTIONS>)
  text = text.replace(/<[^>]+>/g, " ");

  return text;
}

function findFiles(dir, exts, files = []) {
  if (!fs.existsSync(dir)) return files;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findFiles(full, exts, files);
      } else if (exts.some(ext => entry.name.endsWith(ext))) {
        files.push(full);
      }
    }
  } catch (err) {}
  return files;
}

function scanDshFile(filePath) {
  const msgs = [];
  try {
    const raw = fs.readFileSync(filePath);
    let text = "";
    if (filePath.endsWith(".zstd")) {
      if (typeof zlib.zstdDecompressSync === "function") {
        text = zlib.zstdDecompressSync(raw).toString("utf8");
      }
    } else {
      text = raw.toString("utf8");
    }

    if (!text) return msgs;
    const lines = text.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === "user/message" && item.data) {
          const str = extractContent(item.data);
          if (str) msgs.push(sanitizeUserText(str));
        } else if (item.data?.message?.role === "user") {
          const str = extractContent(item.data.message);
          if (str) msgs.push(sanitizeUserText(str));
        }
      } catch (e) {}
    }
  } catch (err) {}
  return msgs;
}

function scanCodexFile(filePath) {
  const msgs = [];
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === "response_item" && item.payload?.role === "user") {
          const parts = item.payload.content || [];
          for (const p of parts) {
            if (p.type === "input_text" && p.text) {
              const cleaned = sanitizeUserText(p.text);
              if (cleaned.trim()) msgs.push(cleaned.trim());
            }
          }
        }
      } catch (e) {}
    }
  } catch (err) {}
  return msgs;
}

function extractContent(obj) {
  if (typeof obj === "string") return obj;
  if (!obj) return "";
  if (typeof obj.content === "string") return obj.content;
  if (Array.isArray(obj.content)) {
    return obj.content
      .map(part => (typeof part === "string" ? part : part?.text || ""))
      .join(" ");
  }
  if (typeof obj.text === "string") return obj.text;
  return "";
}

/**
 * 逃逸正则特殊字符
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scanMultiAgentSessions(sources, wordsList) {
  let totalScannedFiles = 0;
  let totalUserMessages = 0;
  let totalCurseCount = 0;
  const wordHits = {};
  const sourceStats = [];

  // 预编译正则：纯英文词使用 \b 单词边界匹配，中文词使用直接匹配
  const compiledMatchers = [];
  for (const w of wordsList) {
    const key = typeof w === "string" ? w : w.word;
    if (!key || !key.trim()) continue;
    const cleanKey = key.trim();
    wordHits[cleanKey] = 0;

    const isPureAscii = /^[A-Za-z0-9_-]+$/.test(cleanKey);
    let regex;
    try {
      if (isPureAscii) {
        regex = new RegExp("\\b" + escapeRegExp(cleanKey) + "\\b", "gi");
      } else {
        regex = new RegExp(escapeRegExp(cleanKey), "gi");
      }
      compiledMatchers.push({ key: cleanKey, regex });
    } catch (e) {}
  }

  for (const src of sources) {
    if (!src.enabled || !src.path) continue;
    let files = [];
    let msgs = [];

    if (src.type === "codex") {
      files = findFiles(src.path, [".jsonl"]);
      for (const f of files) msgs = msgs.concat(scanCodexFile(f));
    } else {
      files = findFiles(src.path, [".zstd", ".jsonl"]);
      for (const f of files) msgs = msgs.concat(scanDshFile(f));
    }

    totalScannedFiles += files.length;
    totalUserMessages += msgs.length;

    let srcCurses = 0;
    for (const msg of msgs) {
      if (!msg) continue;
      for (const matcher of compiledMatchers) {
        matcher.regex.lastIndex = 0;
        let count = 0;
        while (matcher.regex.exec(msg) !== null) {
          count++;
        }
        if (count > 0) {
          wordHits[matcher.key] = (wordHits[matcher.key] || 0) + count;
          totalCurseCount += count;
          srcCurses += count;
        }
      }
    }

    sourceStats.push({
      id: src.id,
      name: src.name,
      path: src.path,
      filesCount: files.length,
      messagesCount: msgs.length,
      cursesCount: srcCurses
    });
  }

  const rank = Object.entries(wordHits)
    .filter(([_, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({ word, count }));

  return {
    totalScannedFiles,
    totalUserMessages,
    totalCurseCount,
    sourceStats,
    rank
  };
}

