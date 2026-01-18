const fs = require("fs");
const path = require("path");

function loadConfig() {
  const configPath = path.isAbsolute(process.env.CONFIG_PATH || "")
    ? process.env.CONFIG_PATH
    : path.join(process.cwd(), process.env.CONFIG_PATH || "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      "config.json 파일이 없습니다. config.example.json 을 복사해서 config.json 을 만들고 값을 채워주세요."
    );
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const cfg = JSON.parse(raw);

  if (!cfg.telegramBotToken) throw new Error("config.json: telegramBotToken 누락");
  // OpenAI 또는 Gemini API 키 중 하나는 필수
  if (!cfg.openaiApiKey && !cfg.geminiApiKey) {
    throw new Error("config.json: openaiApiKey 또는 geminiApiKey 중 하나는 필수입니다");
  }

  const telegramCfg = cfg.telegram || {};
  const webhookCfg = telegramCfg.webhook || {};

  return {
    telegramBotToken: cfg.telegramBotToken,
    openaiApiKey: cfg.openaiApiKey || null,
    geminiApiKey: cfg.geminiApiKey || null,
    // allowedChatIds:
    // - null/undefined: 전체 허용 (필터 없음)
    // - []: 전체 허용
    // - [id...]: 해당 chatId만 허용
    allowedChatIds: Array.isArray(cfg.allowedChatIds) ? cfg.allowedChatIds : null,

    // legacy (단방향) 지원용. 현재 프로젝트는 auto(한글<->크메르) 사용.
    targetLanguage: cfg.targetLanguage || "Korean",
    // 기본값: 크메르 봇 운영값 기준 (Gemini 우선)
    model: cfg.model || "gemini-2.5-flash",
    // Gemini 실패/제한 시 폴백 (결제/쿼터 문제 대비)
    fallbackModel: cfg.fallbackModel || "gpt-5.2",
    maxInputChars: Number.isFinite(cfg.maxInputChars) ? cfg.maxInputChars : 2500,
    systemPrompt:
      cfg.systemPrompt ||
      "You are a professional translator specializing in Khmer, Vietnamese, and Korean languages. Your task is to translate any text accurately, regardless of length or complexity. Always translate the input text, even if it contains special characters, short phrases, or mixed scripts. Use simple words and clear sentence structures while preserving 100% of the original meaning. Never skip translation or return the original text unchanged. If the input is already in the target language, return it naturally without modification. Preserve emojis, line breaks, and formatting. Output only the translation without any additional commentary or quotes.",

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


