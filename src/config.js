const fs = require("fs");
const path = require("path");

function loadConfig() {
  // 환경변수 우선, 없으면 config.json 사용
  let cfg = {};
  
  // 환경변수에서 설정 로드
  if (process.env.TELEGRAM_BOT_TOKEN || process.env.OPENAI_API_KEY) {
    cfg = {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      openaiApiKey: process.env.OPENAI_API_KEY,
      targetLanguage: process.env.TARGET_LANGUAGE || "Korean",
      model: process.env.MODEL || "gpt-4o-mini",
      allowedChatIds: process.env.ALLOWED_CHAT_IDS ? JSON.parse(process.env.ALLOWED_CHAT_IDS) : [],
      autoTranslate: process.env.AUTO_TRANSLATE !== "false",
      koreanTo: process.env.KOREAN_TO || "Khmer",
      khmerTo: process.env.KHMER_TO || "Korean",
      vietnameseTo: process.env.VIETNAMESE_TO || "Korean",
      assumeLatinIsVietnamese: process.env.ASSUME_LATIN_IS_VIETNAMESE !== "false",
      maxInputChars: parseInt(process.env.MAX_INPUT_CHARS || "2500", 10),
      systemPrompt: process.env.SYSTEM_PROMPT || "you are a translation engine. keep meaning, tone, emojis, and line breaks. keep code blocks. output translation only.",
      telegram: {
        mode: (process.env.TELEGRAM_MODE || "polling").toLowerCase(),
        proxyUrl: process.env.TELEGRAM_PROXY_URL || null,
        webhook: {
          publicUrl: process.env.WEBHOOK_PUBLIC_URL || null,
          path: process.env.WEBHOOK_PATH || "/telegram-webhook",
          host: process.env.WEBHOOK_HOST || "127.0.0.1",
          port: parseInt(process.env.WEBHOOK_PORT || "58010", 10),
          certPath: process.env.WEBHOOK_CERT_PATH || null,
          keyPath: process.env.WEBHOOK_KEY_PATH || null,
        },
      },
    };
  } else {
    // config.json 파일에서 로드
    const configPath = path.join(process.cwd(), "config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(
        "config.json 파일이 없습니다. config.example.json 을 복사해서 config.json 을 만들고 값을 채워주세요."
      );
    }

    const raw = fs.readFileSync(configPath, "utf8");
    cfg = JSON.parse(raw);
  }

  if (!cfg.telegramBotToken) throw new Error("설정 오류: telegramBotToken 누락");
  if (!cfg.openaiApiKey) throw new Error("설정 오류: openaiApiKey 누락");

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

    // auto 번역 (한글<->크메르어 또는 한글<->베트남어)
    autoTranslate: cfg.autoTranslate !== false,
    koreanTo: cfg.koreanTo || "Khmer",
    khmerTo: cfg.khmerTo || "Korean",
    vietnameseTo: cfg.vietnameseTo || "Korean",
    assumeLatinIsVietnamese: cfg.assumeLatinIsVietnamese !== false,

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


