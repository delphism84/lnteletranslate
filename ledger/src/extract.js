// 대화에서 '실제로 일어난 돈 거래'만 뽑아낸다.
//
// 1단계 정규식으로 금액 단서가 없는 메시지를 걷어낸다 (실측: 전체의 약 90% 가 여기서 걸러진다).
// 2단계 남은 것만 AI 에 넣어 판정한다.
//
// 9일치 실제 대화로 검증한 결과, 금액이 언급된 메시지 중 실제 거래는 15% 뿐이었다.
// 나머지 85% 는 시세 이야기·계획·부탁이다. 그래서 자동 저장은 하지 않고 항상 확인을 받는다.

const MONEY_SIGNALS = [
  /[$៛₩]\s*[\d០-៩]/,
  /[\d០-៩]\s*[$៛₩]/,
  /[\d០-៩][\d០-៩,.]*\s*(원|달러|불|리엘|만원|천원)/,
  /[\d០-៩][\d០-៩,.]*\s*(usd|krw|khr|riel|dollar|dollars|won)\b/i,
  /(រៀល|ដុល្លារ)/,
];

/** LLM 을 부르기 전에 공짜로 거르는 1차 필터. */
function hasMoneySignal(text) {
  const haystack = String(text || "");
  if (!haystack.trim()) return false;
  return MONEY_SIGNALS.some((re) => re.test(haystack));
}

const SYSTEM_PROMPT = [
  "너는 커플의 일상 대화에서 '실제로 일어난 돈 거래'만 골라내는 분류기다.",
  "JSON 배열 하나만 출력한다. 설명·코드블록 금지.",
  "",
  "각 원소:",
  '{"i": 입력번호, "is_transaction": true/false, "direction": "expense|income|transfer|null",',
  ' "amount": 숫자|null, "currency": "USD|KHR|KRW|null", "memo": "짧은 한국어"|null,',
  ' "confidence": 0~1, "why": "판단 근거 12자 이내"}',
  "",
  "true 로 둘 것 — 화자가 이미 벌어진 일로 말한 것만:",
  "- 샀다/썼다/냈다/지불했다 → expense",
  "- 받았다/벌었다/입금됐다 → income",
  "- 줬다/보냈다/뽑아줬다 → transfer",
  "",
  "false 로 둘 것 (실제 대화에서 이런 게 85% 다):",
  "- 가격·시세 정보: '400~500달러 정도야', '월 430달러예요', '차는 550$에 보증금 550$'",
  "- 계획·의사: '사줄게', '보낼게', '사고 싶어'",
  "- 조건·가정: '보내고 싶으면 100달러', '있으면 살 텐데'",
  "- 부탁·요구: '돈 보내줘', '100달러 줘'",
  "- 이미 준 돈의 사용처 지시: '내가 준 돈에서 $100는 옷을 사요', '175$ 준 거에서 70$를 쓰세요'",
  "  (돈이 새로 움직인 게 아니라 쓰는 방법을 말하는 것이다)",
  "- 계산·설명: '$200에서 $100 빼면 $100 남아'",
  "- 금액이 아닌 숫자: 시각, 날짜, 나이, 전화번호, 개수",
  "",
  "한 문장에 서로 다른 거래가 둘이면 둘 다 넣어라 (예: '600달러 보낸 후 800,000리엘 보냈어' → 2건).",
  "금액 단위가 분명하지 않으면 currency 를 null 로 둬라. 추측해서 지어내지 마라.",
  "확신이 없으면 is_transaction=false 로 둬라. 놓치는 것보다 잘못 기록하는 게 나쁘다.",
].join("\n");

function stripFence(text) {
  return String(text || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

function normalizeVerdict(raw) {
  const amount = Number(raw.amount);
  const confidence = Number(raw.confidence);
  return {
    index: Number(raw.i),
    isTransaction: raw.is_transaction === true,
    direction: ["expense", "income", "transfer"].includes(raw.direction) ? raw.direction : null,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: ["USD", "KHR", "KRW"].includes(raw.currency) ? raw.currency : null,
    memo: typeof raw.memo === "string" && raw.memo.trim() ? raw.memo.trim().slice(0, 200) : null,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    why: typeof raw.why === "string" ? raw.why.trim().slice(0, 40) : "",
  };
}

async function callGemini(cfg, userText) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(cfg.ai.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: cfg.ai.model,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });
  const result = await model.generateContent(userText);
  return result.response.text();
}

async function callOpenAI(cfg, userText) {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: cfg.ai.openaiApiKey });
  const resp = await client.chat.completions.create({
    model: cfg.ai.fallbackModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n결과는 {"results": [...]} 형태로 감싸서 출력한다.` },
      { role: "user", content: userText },
    ],
  });
  return resp.choices?.[0]?.message?.content || "";
}

/**
 * @param {Array<{original:string, translated:string}>} items
 * @returns {Promise<Array<{index:number, isTransaction:boolean, ...}>>}
 */
async function classifyBatch(cfg, items) {
  if (!items.length) return [];

  const userText = items
    .map((item, i) => `${i}. [원문] ${item.original}\n   [번역] ${item.translated || "(없음)"}`)
    .join("\n");

  const providers = [];
  if (cfg.ai.geminiApiKey) providers.push(["gemini", callGemini]);
  if (cfg.ai.openaiApiKey) providers.push(["openai", callOpenAI]);

  const errors = [];
  for (const [name, call] of providers) {
    try {
      const parsed = JSON.parse(stripFence(await call(cfg, userText)));
      const list = Array.isArray(parsed) ? parsed : parsed.results;
      if (!Array.isArray(list)) throw new Error("배열이 아님");
      return list
        .map(normalizeVerdict)
        .filter((v) => Number.isInteger(v.index) && v.index >= 0 && v.index < items.length);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  throw new Error(`판정 실패 — ${errors.join(" | ")}`);
}

module.exports = { hasMoneySignal, classifyBatch, SYSTEM_PROMPT, MONEY_SIGNALS };
