const fs = require("fs");
const path = require("path");

const DEFAULT_MAX = 60;

function resolveStorePath() {
  const fromEnv = process.env.COVERT_CHAT_STORE;
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), "data", "covert-chats.json");
}

function readStore(storePath = resolveStorePath()) {
  try {
    if (!fs.existsSync(storePath)) return { chats: [], updatedAt: null };
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return {
      chats: Array.isArray(raw.chats) ? raw.chats : [],
      updatedAt: raw.updatedAt || null,
    };
  } catch {
    return { chats: [], updatedAt: null };
  }
}

/**
 * @param {object} entry
 * @param {string} entry.original
 * @param {string} entry.translated
 * @param {string} [entry.sourceScript]
 * @param {string} [entry.targetLanguage]
 * @param {number|string} [entry.chatId]
 * @param {string} [entry.source] - "telegram" | "covert-web"
 */
function appendCovertChat(entry, opts = {}) {
  const storePath = opts.storePath || resolveStorePath();
  const max = Number.isFinite(opts.max) ? opts.max : DEFAULT_MAX;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  const store = readStore(storePath);
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    chatId: entry.chatId ?? null,
    original: String(entry.original || "").trim(),
    translated: String(entry.translated || "").trim(),
    sourceScript: entry.sourceScript || null,
    targetLanguage: entry.targetLanguage || null,
    source: entry.source || "telegram",
  };
  if (!item.original && !item.translated) return store;

  store.chats.push(item);
  if (store.chats.length > max) store.chats = store.chats.slice(-max);
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  return store;
}

module.exports = {
  resolveStorePath,
  readStore,
  appendCovertChat,
  DEFAULT_MAX,
};
