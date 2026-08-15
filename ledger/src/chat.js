// 가계부 동작으로 해석되지 않는 평문을 일반 AI 대화로 받아준다.
// 라우터(ai.js)가 action="chat" 을 돌려줬을 때만 여기로 온다.
//
// 답변은 parse_mode 없이 평문으로 보낸다. 모델이 마크다운이나 <, & 를 뱉어도
// 텔레그램 HTML 파서가 깨지지 않게 하기 위함이다.

const TELEGRAM_LIMIT = 4000; // 실제 제한은 4096, 여유를 둔다

function buildSystemPrompt(ctx) {
  return [
    "너는 텔레그램에서 한 사람과 1:1로 대화하는 비서다. 이름은 '가계부 봇'.",
    "주 역할은 가계부 관리지만, 그 외의 대화도 자연스럽게 받아준다.",
    "",
    "말투:",
    "- 한국어로, 친근하지만 과하지 않게. 이모지는 필요할 때만.",
    "- 짧게 답한다. 텔레그램 대화이므로 3~4문장을 넘기지 않는다.",
    "  단, 사용자가 설명이나 목록을 요청하면 그때는 충분히 길게 써도 된다.",
    "- 마크다운 표(|---|)나 코드블록은 쓰지 않는다. 텔레그램에서 깨진다.",
    "",
    "가계부 관련:",
    `- 오늘은 ${ctx.today} 다.`,
    "- 아래 '현재 가계부 상황'을 참고해 돈 관련 질문에 답할 수 있다.",
    "- **중요**: 이 봇은 사용자가 평문으로 말하면 그대로 장부에 기록한다.",
    "  '제가 직접 기록할 수 없다', '명령어로 입력해야 한다' 같은 안내는 사실이 아니다. 절대 그렇게 말하지 마라.",
    "- 사용자가 기록을 원하는 것 같은데 네가 대화로 답하게 된 상황이면,",
    "  방금 정리한 내용을 그대로 저장하려면 <저장> 이라고 치면 된다고 알려줘라. (/저장 또는 /aiok)",
    "- 집계는 /showcalc, 목록은 /list, 취소는 /del 이다.",
    "- 없는 숫자를 지어내지 마라. 모르면 모른다고 해라.",
    "",
    "현재 가계부 상황:",
    ctx.ledgerSummary || "(기록 없음)",
  ].join("\n");
}

async function callGemini(cfg, systemPrompt, history, userText) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(cfg.ai.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: cfg.ai.model,
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0.7 },
  });

  const contents = history.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));
  contents.push({ role: "user", parts: [{ text: userText }] });

  const result = await model.generateContent({ contents });
  return result.response.text();
}

async function callOpenAI(cfg, systemPrompt, history, userText) {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: cfg.ai.openaiApiKey });
  const resp = await client.chat.completions.create({
    model: cfg.ai.fallbackModel,
    temperature: 0.7,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: userText },
    ],
  });
  return resp.choices?.[0]?.message?.content || "";
}

/**
 * @param {Array<{role:'user'|'assistant', content:string}>} history 오래된 것부터
 * @returns {Promise<{text:string, provider:string}>}
 */
async function chat(cfg, userText, { history = [], ctx = {} } = {}) {
  const systemPrompt = buildSystemPrompt(ctx);
  const providers = [];
  if (cfg.ai.geminiApiKey) providers.push(["gemini", callGemini]);
  if (cfg.ai.openaiApiKey) providers.push(["openai", callOpenAI]);

  const errors = [];
  for (const [name, call] of providers) {
    try {
      const text = String(await call(cfg, systemPrompt, history, userText) || "").trim();
      if (text) return { text, provider: name };
      errors.push(`${name}: 빈 응답`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  throw new Error(errors.join(" | ") || "AI 제공자가 없습니다.");
}

/** 텔레그램 길이 제한에 맞춰 문단 경계로 자른다. */
function splitForTelegram(text, limit = TELEGRAM_LIMIT) {
  const source = String(text || "");
  if (source.length <= limit) return [source];

  const chunks = [];
  let rest = source;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

module.exports = { chat, splitForTelegram, buildSystemPrompt };
