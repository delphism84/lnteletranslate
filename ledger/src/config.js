const fs = require("fs");
const path = require("path");

const BOOKS = ["home", "office"];
const CURRENCIES = ["USD", "KHR", "KRW"];

function resolveConfigPath() {
  if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH;
  return path.join(__dirname, "..", "config.json");
}

function loadConfig() {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`설정 파일이 없습니다: ${configPath} (config.example.json 을 복사하세요)`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));

  if (!raw.telegramBotToken) throw new Error("telegramBotToken 이 비어 있습니다.");
  if (!raw.db || !raw.db.host) throw new Error("db 설정이 비어 있습니다.");

  const fx = Object.assign({ USD: 1, KHR: 4100, KRW: 1380 }, raw.fx || {});
  for (const cur of CURRENCIES) {
    if (!(Number(fx[cur]) > 0)) throw new Error(`fx.${cur} 환율이 올바르지 않습니다.`);
  }

  const defaultBook = BOOKS.includes(raw.defaultBook) ? raw.defaultBook : "home";
  const defaultCurrency = CURRENCIES.includes(raw.defaultCurrency) ? raw.defaultCurrency : "USD";

  // chatBooks 키는 JSON 상 문자열이므로 그대로 문자열 키로 정규화한다.
  const chatBooks = {};
  for (const [chatId, book] of Object.entries(raw.chatBooks || {})) {
    if (BOOKS.includes(book)) chatBooks[String(chatId)] = book;
  }

  // 명령어가 아닌 평문을 해석하는 AI 라우터. 키가 하나도 없으면 자동으로 꺼진다.
  const aiRaw = raw.ai || {};
  const ai = {
    enabled: aiRaw.enabled !== false && Boolean(aiRaw.geminiApiKey || aiRaw.openaiApiKey),
    geminiApiKey: aiRaw.geminiApiKey || null,
    openaiApiKey: aiRaw.openaiApiKey || null,
    model: aiRaw.model || "gemini-2.5-flash",
    fallbackModel: aiRaw.fallbackModel || "gpt-5.2",
    recentEntryCount: Number(aiRaw.recentEntryCount) || 5,
    // 가계부 동작이 아닌 평문을 일반 AI 대화로 받아줄지
    chatEnabled: aiRaw.chatEnabled !== false,
    historyTurns: Number(aiRaw.historyTurns) || 10,
    // 이보다 오래된 기록을 '방금 것'으로 지우려 하면 경고를 붙인다.
    recentMinutes: Number(aiRaw.recentMinutes) || 60,
  };

  // 번역봇이 남기는 대화 로그에서 거래를 자동 추출한다. AI 가 꺼져 있으면 같이 꺼진다.
  const autoRaw = raw.autoExtract || {};
  const autoExtract = {
    enabled: autoRaw.enabled === true && ai.enabled,
    sourceFile: autoRaw.sourceFile || "/app/covert-data/covert-chats.json",
    pollSeconds: Number(autoRaw.pollSeconds) || 180,
    minConfidence: Number.isFinite(Number(autoRaw.minConfidence)) ? Number(autoRaw.minConfidence) : 0.8,
    duplicateWindowHours: Number(autoRaw.duplicateWindowHours) || 24,
    // 확인 메시지를 받을 곳. 보통 소유자와의 DM.
    notifyChatId: Number(autoRaw.notifyChatId) || null,
    // 첫 실행 때 파일에 남아 있던 과거 대화까지 처리할지 (기본: 안 함)
    processBacklogOnStart: autoRaw.processBacklogOnStart === true,
  };
  if (autoExtract.enabled && !autoExtract.notifyChatId) {
    throw new Error("autoExtract.notifyChatId 가 필요합니다 (확인 메시지를 받을 DM chat_id).");
  }

  return {
    configPath,
    telegramBotToken: raw.telegramBotToken,
    ai,
    autoExtract,
    db: {
      // 컨테이너 안에서는 lunar-mariadb:3306, 호스트에서 테스트할 때는 127.0.0.1:13306 으로 붙어야 한다.
      host: process.env.LEDGER_DB_HOST || raw.db.host,
      port: Number(process.env.LEDGER_DB_PORT || raw.db.port) || 3306,
      user: raw.db.user,
      password: raw.db.password,
      database: raw.db.database || "lunar_ledger",
    },
    timezone: raw.timezone || "Asia/Seoul",
    ownerUserIds: (raw.ownerUserIds || []).map(Number).filter(Number.isFinite),
    allowedChatIds: (raw.allowedChatIds || []).map(Number).filter(Number.isFinite),
    chatBooks,
    defaultBook,
    defaultCurrency,
    fx,
  };
}

module.exports = { loadConfig, BOOKS, CURRENCIES };
