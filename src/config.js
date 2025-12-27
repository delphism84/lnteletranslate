const fs = require("fs");
const path = require("path");

function loadConfig() {
  const configPath = path.join(process.cwd(), "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      "config.json 파일이 없습니다. config.example.json 을 복사해서 config.json 을 만들고 값을 채워주세요."
    );
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const cfg = JSON.parse(raw);

  if (!cfg.telegramBotToken) throw new Error("config.json: telegramBotToken 누락");
  if (!cfg.openaiApiKey) throw new Error("config.json: openaiApiKey 누락");

  const telegramCfg = cfg.telegram || {};
  const webhookCfg = telegramCfg.webhook || {};

  return {
    telegramBotToken: cfg.telegramBotToken,
    openaiApiKey: cfg.openaiApiKey,
    // allowedChatIds:
    // - null/undefined: 전체 허용 (필터 없음)
    // - []: 전체 허용
    // - [id...]: 해당 chatId만 허용
    allowedChatIds: Array.isArray(cfg.allowedChatIds) ? cfg.allowedChatIds : null,

    // legacy (단방향) 지원용. 현재 프로젝트는 auto(한글<->크메르) 사용.
    targetLanguage: cfg.targetLanguage || "Korean",
    model: cfg.model || "gpt-5.2",
    maxInputChars: Number.isFinite(cfg.maxInputChars) ? cfg.maxInputChars : 2500,
    systemPrompt:
      cfg.systemPrompt ||
      "you are a translation engine. keep meaning, tone, emojis, and line breaks. keep code blocks. output translation only.",

    // auto 번역 (한글<->크메르어)
    autoTranslate: cfg.autoTranslate !== false,
    koreanTo: cfg.koreanTo || "Khmer",
    khmerTo: cfg.khmerTo || "Korean",

    // telegram runtime
    // - mode: "polling"(기본) | "webhook"
    // - proxyUrl: 텔레그램 접속이 막힌 환경이면 프록시를 통해 연결 (예: http://127.0.0.1:7890)
    // - webhook: mode가 webhook일 때만 사용
    telegram: {
      mode: (telegramCfg.mode || cfg.telegramMode || "polling").toLowerCase(),
      proxyUrl: telegramCfg.proxyUrl || cfg.telegramProxyUrl || cfg.proxyUrl || null,
      webhook: {
        publicUrl: webhookCfg.publicUrl || cfg.webhookPublicUrl || null,
        path: webhookCfg.path || cfg.webhookPath || "/telegram-webhook",
        host: webhookCfg.host || cfg.webhookHost || "127.0.0.1",
        port: Number.isFinite(webhookCfg.port)
          ? webhookCfg.port
          : Number.isFinite(cfg.webhookPort)
            ? cfg.webhookPort
            : 58010,
        certPath: webhookCfg.certPath || cfg.webhookCertPath || null,
        keyPath: webhookCfg.keyPath || cfg.webhookKeyPath || null,
      },
    },
  };
}

module.exports = { loadConfig };


