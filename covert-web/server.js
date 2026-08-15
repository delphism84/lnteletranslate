const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const TelegramBot = require("node-telegram-bot-api");

const ROOT = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const traCfg = JSON.parse(fs.readFileSync(cfg.traConfigPath, "utf8"));

const { createOpenAIClient, createGeminiClient, translateTextInChunks } = require("../src/openaiClient");
const { resolveMaxChunkChars } = require("../src/textChunker");
const { appendCovertChat, readStore } = require("../src/covertChatStore");

/** tra 봇(index.js)과 동일한 방향별 system prompt 조합 */
function buildSystemPromptForDirection(basePrompt, registerPrompts, targetLanguage, script) {
  const base = (basePrompt || "").trim();
  let extra = "";
  if (targetLanguage === "Khmer" && script === "hangul") {
    extra = (registerPrompts?.promptRegisterKoreanToKhmer || "").trim();
  } else if (targetLanguage === "Korean" && script === "khmer") {
    extra = (registerPrompts?.promptRegisterKhmerToKorean || "").trim();
  }
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}

function loadContextPairs(limit) {
  const n = Number.isFinite(limit) ? Math.max(0, limit) : 0;
  if (n <= 0) return [];
  const store = readStore(cfg.chatStorePath);
  const pairs = [];
  for (const chat of store.chats || []) {
    const original = String(chat?.original || "").trim();
    const translated = String(chat?.translated || "").trim();
    if (!original || !translated) continue;
    // 한글→크메르 쌍만 컨텍스트로 사용 (tra ko→km 방향과 동일)
    if (chat.sourceScript === "hangul" || chat.targetLanguage === "Khmer") {
      pairs.push({ original, translated });
    }
  }
  return pairs.slice(-n);
}

const COOKIE = "c_sess";
const LINE_COUNT = cfg.javaLineCount || 1000;

const openaiClient = traCfg.openaiApiKey ? createOpenAIClient(traCfg.openaiApiKey) : null;
const geminiClient = traCfg.geminiApiKey ? createGeminiClient(traCfg.geminiApiKey) : null;
// tra 그룹 전송 전용 봇 (transKhmer_sendtotra_bot) — tra 번역봇과 분리
const botToken = cfg.sendBotToken || traCfg.bots?.[0]?.telegramBotToken;
if (!botToken) throw new Error("sendBotToken missing");
const bot = new TelegramBot(botToken, { polling: false });
console.log(
  `[covert-web] outbound bot=${cfg.sendBotUsername || "unknown"} group=${cfg.groupChatId}`
);

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", cfg.sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", cfg.sessionSecret).update(body).digest("base64url");
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.ok || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const payload = verify(req.cookies?.[COOKIE]);
  if (!payload) return res.status(401).json({ error: "auth" });
  req.session = payload;
  next();
}

/** 연인·애정 암시 표현 → "배송" (c.dair.co.kr 표시 전용; 텔레그램 송수신 원문은 치환하지 않음) */
const ROMANTIC_PATTERNS = [
  // longer phrases / longer alternates first
  /보고\s*싶(?:습니다|어요|네요|구나|군|다|어)?/gi,
  /그리[워우](?:워요|웠어|웠다|운|워)?/gi,
  /안아\s*(?:주세요|버려|줘요|달라|줘)?/gi,
  /안고\s*싶(?:어요|다|어)?/gi,
  /뽀뽀\s*(?:해줘|하자|해요|해)?/gi,
  /키스\s*(?:해줘|하자|하고|해요|해)?/gi,
  /사랑(?:스러워|스러운|스런|합니다|해요|한다|했어|하고|하는|이야요|이야|해|한|아|을|이)?/gi,
  /좋아해요/gi,
  /좋아해/gi,
  /좋아한다고/gi,
  /좋아한다/gi,
  /내\s*사람/gi,
  /자기야/gi,
  /여보/gi,
  /애인/gi,
  /연인/gi,
  /\bDarling\b/gi,
  /\bsweetheart\b/gi,
  /\bhoney\b/gi,
  /love\s*you/gi,
  /miss\s*you/gi,
  /\bkiss(?:es|ing)?\b/gi,
  // Khmer intimate
  /ស្រលាញ់(?:អូន|បង)?/g,
  /ឱប/g,
  /ថើប/g,
  /នឹក(?:ខ្លាំង)?/g,
  // bare 자기 last (short)
  /자기/gi,
];

function redactRomantic(text) {
  let s = String(text || "");
  for (const re of ROMANTIC_PATTERNS) {
    s = s.replace(re, "배송");
  }
  // collapse accidental repeats: 배송배송 / 배송 배송 → 배송
  s = s.replace(/(?:배송)(?:\s*배송)+/g, "배송");
  s = s.replace(/(?:배송){2,}/g, "배송");
  return s;
}

function maskChat(chat) {
  if (!chat) return null;
  return {
    ...chat,
    original: redactRomantic(chat.original),
    translated: redactRomantic(chat.translated),
  };
}

function hasHangul(text) {
  return /[\uAC00-\uD7A3]/.test(String(text || ""));
}

/**
 * 최근 송수신 한글 + media signal 추출 (최대 20)
 * - 한글 원문 (텔레그램 입력 + 웹에서 내가 보낸 것)
 * - tra가 보낸 한국어 번역본
 * - emot / picture (스티커·이모지·사진 알림)
 */
function loadKoreanSentences() {
  const store = readStore(cfg.chatStorePath);
  const frames = [];

  for (const raw of store.chats || []) {
    const chat = maskChat(raw);
    if (!chat) continue;

    const orig = String(chat.original || "").trim();
    const tr = String(chat.translated || "").trim();

    // 미디어 신호: 표시용 그대로 (배송 치환 없음 — maskChat 후도 emot/picture 유지)
    if (orig === "emot" || orig === "picture") {
      frames.push({
        id: `${chat.id}:signal`,
        ts: chat.ts,
        text: orig,
        role: "signal",
        sourceId: chat.id,
      });
      continue;
    }

    // 한글 원문: 웹 전송 + 텔레그램에서 한글로 보낸 메시지
    if (orig && hasHangul(orig)) {
      frames.push({
        id: `${chat.id}:ko`,
        ts: chat.ts,
        text: orig,
        role:
          chat.source === "covert-web" || chat.source === "lnteletranslate-relay"
            ? "me"
            : "ko",
        sourceId: chat.id,
      });
    }

    // tra가 보낸 한글 번역본 (크메르→한국어 등)
    if (
      tr &&
      hasHangul(tr) &&
      (chat.targetLanguage === "Korean" || chat.sourceScript === "khmer")
    ) {
      // 원문과 동일한 한글이면 중복 스킵
      if (tr !== orig) {
        frames.push({
          id: `${chat.id}:tra`,
          ts: chat.ts + 1,
          text: tr,
          role: "tra",
          sourceId: chat.id,
        });
      }
    }
  }

  return frames.slice(-20);
}

/** Escape one Korean sentence into a Java string literal line */
function chatAsJavaLine(frame, indent = "        ") {
  const text = String(frame?.text || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  const tag = frame?.role === "me" ? "out" : frame?.role === "tra" ? "in" : "msg";
  return `${indent}final String runtimeHint_${tag} = "${text}"; // keep`;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  return crypto.createHash("sha256").update(String(str)).digest().readUInt32BE(0);
}

const JAVA_SNIPPETS = [
  "package com.lunar.runtime.cfg;",
  "",
  "import java.util.ArrayList;",
  "import java.util.HashMap;",
  "import java.util.List;",
  "import java.util.Map;",
  "import java.util.concurrent.atomic.AtomicInteger;",
  "import java.nio.charset.StandardCharsets;",
  "import java.security.MessageDigest;",
  "",
  "/**",
  " * Generated bootstrap scaffold. Do not edit by hand.",
  " * Build fingerprint is resolved at class-load time.",
  " */",
  "public final class SessionBootstrap {",
  "",
  "    private static final int DEFAULT_CAPACITY = 256;",
  "    private static final int MAX_RETRY = 3;",
  "    private static final AtomicInteger SEQ = new AtomicInteger();",
  "",
  "    private final Map<String, Object> cache = new HashMap<>();",
  "    private final List<String> trail = new ArrayList<>();",
  "    private volatile boolean ready;",
  "",
  "    public SessionBootstrap() {",
  "        this.ready = false;",
  "    }",
  "",
];

const METHOD_BODIES = [
  (i, rnd) => `    private int computeBlock${i}(int seed) {\n        int x = seed ^ ${Math.floor(rnd() * 9000) + 1000};\n        x = (x << 3) - x + ${i};\n        return Math.floorMod(x, ${Math.floor(rnd() * 500) + 50});\n    }\n`,
  (i, rnd) => `    private String encodeToken${i}(byte[] raw) {\n        StringBuilder sb = new StringBuilder(raw.length * 2);\n        for (byte b : raw) {\n            sb.append(String.format("%02x", b));\n        }\n        return sb.append(":").append(${i}).toString();\n    }\n`,
  (i, rnd) => `    private void warmCache${i}() {\n        for (int n = 0; n < ${Math.floor(rnd() * 8) + 2}; n++) {\n            cache.put("k" + n + "_${i}", n * ${Math.floor(rnd() * 17) + 3});\n        }\n        trail.add("warm-${i}");\n    }\n`,
  (i, rnd) => `    public boolean validateFrame${i}(String input) {\n        if (input == null || input.isEmpty()) return false;\n        int h = input.hashCode();\n        return (h & 0xff) != ${Math.floor(rnd() * 200)};\n    }\n`,
  (i, rnd) => `    private List<Integer> sampleOffsets${i}() {\n        List<Integer> out = new ArrayList<>();\n        for (int j = 0; j < ${Math.floor(rnd() * 5) + 2}; j++) {\n            out.add(j * ${Math.floor(rnd() * 13) + 7} + ${i});\n        }\n        return out;\n    }\n`,
];

function generateJavaLines(frames, focusIndex = 0) {
  const list = Array.isArray(frames) ? frames.slice(-20) : [];
  const focus =
    list.length === 0
      ? null
      : list[Math.max(0, Math.min(list.length - 1, Number(focusIndex) || 0))];
  const seed = hashSeed(focus?.id || `empty-${focusIndex}`);
  const rnd = mulberry32(seed);
  const lines = Array(LINE_COUNT).fill(null);

  // 채팅 1개만 1000줄 사이 띄엄띄엄(중간 대역 랜덤 1줄)
  let chatLineIndex = null;
  const chatLineIndices = [];
  if (focus) {
    const bandStart = 90;
    const bandEnd = LINE_COUNT - 80;
    chatLineIndex = bandStart + Math.floor(rnd() * Math.max(1, bandEnd - bandStart));
    lines[chatLineIndex] = chatAsJavaLine(focus);
    chatLineIndices.push(chatLineIndex);
  }

  let cursor = 0;
  let methodIdx = 0;
  const write = (s) => {
    while (cursor < LINE_COUNT && lines[cursor] != null) cursor++;
    if (cursor >= LINE_COUNT) return;
    lines[cursor++] = s;
  };

  for (const s of JAVA_SNIPPETS) write(s);

  while (cursor < LINE_COUNT - 25) {
    while (cursor < LINE_COUNT && lines[cursor] != null) cursor++;
    if (cursor >= LINE_COUNT - 25) break;
    const gen = METHOD_BODIES[methodIdx % METHOD_BODIES.length];
    const block = gen(methodIdx, rnd).split("\n");
    for (const row of block) {
      while (cursor < LINE_COUNT && lines[cursor] != null) cursor++;
      if (cursor >= LINE_COUNT - 25) break;
      lines[cursor++] = row;
    }
    methodIdx++;
  }

  const footer = [
    "",
    "    public void bootstrap() {",
    "        if (ready) return;",
    "        this.ready = true;",
    "    }",
    "",
    "    public boolean isReady() {",
    "        return ready;",
    "    }",
    "",
    "    public static void main(String[] args) {",
    "        SessionBootstrap app = new SessionBootstrap();",
    "        app.bootstrap();",
    '        System.out.println("ok:" + app.isReady());',
    "    }",
    "}",
  ];
  for (const s of footer) write(s);
  while (cursor < LINE_COUNT) {
    while (cursor < LINE_COUNT && lines[cursor] != null) cursor++;
    if (cursor >= LINE_COUNT) break;
    lines[cursor++] = `    // pad ${cursor}`;
  }
  for (let i = 0; i < LINE_COUNT; i++) {
    if (lines[i] == null) lines[i] = `    // pad ${i}`;
  }

  return {
    lines,
    chatLineIndex: chatLineIndex ?? 0,
    chatLineIndices,
    totalLines: LINE_COUNT,
  };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use(express.static(path.join(ROOT, "public"), { index: false }));

app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/unlock", (req, res) => {
  const pin = String(req.body?.pin || "").trim();
  if (pin !== String(cfg.pin)) {
    return res.status(403).json({ error: "invalid" });
  }
  const hours = cfg.sessionHours || 12;
  const token = sign({ ok: true, exp: Date.now() + hours * 3600 * 1000 });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: hours * 3600 * 1000,
  });
  res.json({ ok: true });
});

app.post("/api/lock", (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const payload = verify(req.cookies?.[COOKIE]);
  res.json({ ok: Boolean(payload) });
});

app.get("/api/view", requireAuth, (req, res) => {
  const frames = loadKoreanSentences();
  const count = frames.length;
  let index = Number(req.query.index);
  // 로딩 시( index 미지정 ) 항상 가장 최근 한글 문장 1개
  if (!Number.isFinite(index) || index < 0) index = Math.max(0, count - 1);

  if (count === 0) {
    const pack = generateJavaLines([], 0);
    return res.json({
      count: 0,
      index: 0,
      chat: null,
      chatLineIndex: pack.chatLineIndex,
      chatLineIndices: pack.chatLineIndices,
      lines: pack.lines,
    });
  }

  index = Math.max(0, Math.min(count - 1, index));
  const frame = frames[index];
  const pack = generateJavaLines(frames, index);
  res.json({
    count,
    index,
    chat: {
      id: frame.id,
      ts: frame.ts,
      text: frame.text,
      role: frame.role,
      original: frame.text,
      translated: "",
    },
    chatLineIndex: pack.chatLineIndex,
    chatLineIndices: pack.chatLineIndices,
    lines: pack.lines,
  });
});

app.post("/api/send", requireAuth, async (req, res) => {
  const korean = String(req.body?.text || "").trim();
  if (!korean) return res.status(400).json({ error: "empty" });
  if (korean.length > 2000) return res.status(400).json({ error: "too long" });

  try {
    // 전송·저장은 원문 그대로. 사랑/연인 → 배송 치환은 /api/view 표시(maskChat)에서만.
    // 번역 파라미터는 lnteletranslate_tra 봇과 동일하게 맞춤.
    const model = traCfg.koreanToKhmerModel || traCfg.model || "gemini-2.5-flash";
    const fallbackModel = traCfg.fallbackModel || null;
    const contextPairCount = Number(traCfg.contextPairCount) || 0;
    const systemPrompt = buildSystemPromptForDirection(
      traCfg.systemPrompt,
      {
        promptRegisterKoreanToKhmer: traCfg.promptRegisterKoreanToKhmer || "",
        promptRegisterKhmerToKorean: traCfg.promptRegisterKhmerToKorean || "",
      },
      "Khmer",
      "hangul"
    );
    const maxChunkChars = resolveMaxChunkChars({
      model,
      fallbackModel,
      cfg: traCfg,
    });
    const parts = await translateTextInChunks({
      client: openaiClient,
      geminiClient,
      model,
      fallbackModel,
      systemPrompt,
      targetLanguage: "Khmer",
      text: korean,
      contextPairs: loadContextPairs(contextPairCount),
      sourceScript: "hangul",
      contextPairCount,
      maxChunkChars,
      maxChunks: traCfg.maxChunks || 20,
      romanticKhmerRegister: traCfg.romanticKhmerRegister === true,
    });
    const khmer = parts
      .map((p) => p?.translated?.trim())
      .filter(Boolean)
      .join("\n");
    if (!khmer) return res.status(502).json({ error: "translate failed" });

    const message = `${korean}\n${khmer}`;
    const outboundId = Number(cfg.groupChatId);
    const allow = Array.isArray(cfg.allowedOutboundChatIds)
      ? cfg.allowedOutboundChatIds.map(Number)
      : [outboundId];
    if (!allow.includes(outboundId)) {
      return res.status(403).json({ error: "outbound chat not allowed" });
    }
    await bot.sendMessage(outboundId, message, { disable_web_page_preview: true });

    // Function Check DM (sendtotra bot -> operator)
    const notifyIds = Array.isArray(cfg.functionCheckChatIds) && cfg.functionCheckChatIds.length
      ? cfg.functionCheckChatIds.map(Number)
      : [];
    for (const nid of notifyIds) {
      try {
        await bot.sendMessage(nid, "Function Check", { disable_web_page_preview: true });
      } catch (e) {
        console.warn("[function-check] fail", nid, e?.message || e);
      }
    }

    appendCovertChat(
      {
        chatId: cfg.groupChatId,
        original: korean,
        translated: khmer,
        sourceScript: "hangul",
        targetLanguage: "Khmer",
        source: "covert-web",
      },
      { storePath: cfg.chatStorePath, max: 60 }
    );

    const frames = loadKoreanSentences();
    res.json({ ok: true, index: Math.max(0, frames.length - 1), preview: message });
  } catch (err) {
    console.error("[send]", err);
    res.status(500).json({ error: err.message || "send failed" });
  }
});

app.listen(cfg.port, cfg.host, () => {
  console.log(`covert-web on http://${cfg.host}:${cfg.port}`);
});
