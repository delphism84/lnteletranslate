const fs = require("fs");
const path = require("path");

const DEFAULT_PROMPT_REGISTER_KOREAN_TO_KHMER =
  "자연스러운 크메르어로 번역한다. 한국어 조건·가정(-면, -으면, -지면, -거든, -면은)은 크메르 조건(បើ, ពេល, នៅពេល, ...រួច)으로 번역하고, 아직 일어나지 않은 일을 과거/완료(ហើយ, រួចហើយ)로 쓰지 않는다. 원문이 '이미 ~했다'일 때만 완료 표현을 쓴다.";
const DEFAULT_PROMPT_REGISTER_KHMER_TO_KOREAN =
  "자연스러운 한국어로 번역한다. 크메르 존칭·애칭(អូន/បង 등)을 한국어 대화체에 맞게 의역한다. 부정문(កុំ)과 의문문(ទេ/អត់)의 극성을 정확히 반영한다.";

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

  // 멀티봇: bots 배열 또는 단일 telegramBotToken(레거시)
  const bots = Array.isArray(cfg.bots) && cfg.bots.length > 0
    ? cfg.bots
    : cfg.telegramBotToken
      ? [{ id: "default", telegramBotToken: cfg.telegramBotToken, webhookPath: "/telegram-webhook" }]
      : null;
  if (!bots || bots.length === 0) {
    throw new Error("config.json: bots 배열 또는 telegramBotToken이 필요합니다");
  }
  for (const b of bots) {
    if (!b.telegramBotToken) throw new Error(`config.json: bots[].telegramBotToken 누락 (id=${b.id || "?"})`);
  }

  // OpenAI 또는 Gemini API 키 중 하나는 필수
  if (!cfg.openaiApiKey && !cfg.geminiApiKey) {
    throw new Error("config.json: openaiApiKey 또는 geminiApiKey 중 하나는 필수입니다");
  }

  const telegramCfg = cfg.telegram || {};
  const webhookCfg = telegramCfg.webhook || {};

  return {
    bots,
    telegramBotToken: bots[0]?.telegramBotToken, // 레거시 호환
    openaiApiKey: cfg.openaiApiKey || null,
    geminiApiKey: cfg.geminiApiKey || null,
    // allowedChatIds:
    // - null/undefined: 전체 허용 (필터 없음)
    // - []: 전체 허용
    // - [id...]: 해당 chatId만 허용
    allowedChatIds: Array.isArray(cfg.allowedChatIds) ? cfg.allowedChatIds : null,

    // legacy (단방향) 지원용. 현재 프로젝트는 auto(한글<->크메르) 사용.
    targetLanguage: cfg.targetLanguage || "Korean",
    // 기본값: 크메르 봇 운영값 기준 (Gemini Flash 우선 — pro는 API 키별 미지원 가능)
    model: cfg.model || "gemini-2.5-flash",
    // Gemini 실패 시 OpenAI 폴백 (null/"" 이면 비활성)
    fallbackModel:
      cfg.fallbackModel === null || cfg.fallbackModel === "" || cfg.fallbackModel === false
        ? null
        : typeof cfg.fallbackModel === "string" && cfg.fallbackModel.trim()
          ? cfg.fallbackModel.trim()
          : null,
    // 방향별 모델(선택). 미설정 시 model 사용.
    khmerToKoreanModel: cfg.khmerToKoreanModel || null,
    koreanToKhmerModel: cfg.koreanToKhmerModel || null,
    // 번역 시 참고할 최근 원문+번역 쌍 개수
    contextPairCount: Number.isFinite(cfg.contextPairCount) ? cfg.contextPairCount : 3,
    maxChunks: Number.isFinite(cfg.maxChunks) ? cfg.maxChunks : 20,
    maxChunkChars: Number.isFinite(cfg.maxChunkChars) ? cfg.maxChunkChars : null,
    maxInputChars: Number.isFinite(cfg.maxInputChars) ? cfg.maxInputChars : 8000,
    systemPrompt:
      cfg.systemPrompt ||
      "You are a translator. Translate into the requested target language. Preserve line breaks and emojis. Output only the translation.",
    promptRegisterKoreanToKhmer:
      typeof cfg.promptRegisterKoreanToKhmer === "string" && cfg.promptRegisterKoreanToKhmer.trim()
        ? cfg.promptRegisterKoreanToKhmer.trim()
        : DEFAULT_PROMPT_REGISTER_KOREAN_TO_KHMER,
    promptRegisterKhmerToKorean:
      typeof cfg.promptRegisterKhmerToKorean === "string" && cfg.promptRegisterKhmerToKorean.trim()
        ? cfg.promptRegisterKhmerToKorean.trim()
        : DEFAULT_PROMPT_REGISTER_KHMER_TO_KOREAN,

    // auto 번역 (한글<->크메르어 또는 한글<->베트남어)
    autoTranslate: cfg.autoTranslate !== false,
    koreanTo: cfg.koreanTo || "Khmer",
    khmerTo: cfg.khmerTo || "Korean",
    vietnameseTo: cfg.vietnameseTo || "Korean",
    assumeLatinIsVietnamese: cfg.assumeLatinIsVietnamese === true,
    romanticKhmerRegister: cfg.romanticKhmerRegister === true,

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


