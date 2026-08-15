// 명령어가 아닌 평문을 해석해서 가계부 동작으로 바꾼다.
// Gemini 를 먼저 쓰고, 실패하면 OpenAI 로 폴백한다 (번역봇과 같은 구성).

const ACTIONS = [
  "record",       // 새 기록 추가
  "delete_last",  // 최근 기록 취소
  "delete_id",    // 번호 지정 취소
  "undo_last",    // 방금 취소한 것 복구
  "summary",      // 집계표
  "balance",      // 잔액
  "list",         // 최근 목록
  "set_book",     // 이 방 기본 가계부 변경
  "help",
  "chat",         // 가계부 동작이 아닌 일반 대화 -> chat.js 로 넘긴다
  "unknown",
];

const SCHEMA_TEXT = `{
  "action": "record | delete_last | delete_id | undo_last | summary | balance | list | set_book | help | chat | unknown",
  "records": [
    {
      "direction": "expense | income | transfer",
      "amount": 숫자,
      "currency": "USD | KHR | KRW | null",
      "book": "home | office | null",
      "memo": "문자열 또는 null",
      "occurred_at": "YYYY-MM-DD 또는 null"
    }
  ],
  "count": 정수 또는 null,
  "entry_id": 정수 또는 null,
  "period": "today | week | month | YYYY-MM | null",
  "reply": "사용자에게 보여줄 짧은 한국어 한 문장"
}`;

function buildSystemPrompt(ctx) {
  return [
    "너는 텔레그램 가계부 봇의 명령 해석기다. 사용자의 한국어 문장을 아래 JSON 하나로만 변환한다.",
    "설명, 코드블록, 마크다운 없이 JSON 객체만 출력한다.",
    "",
    "스키마:",
    SCHEMA_TEXT,
    "",
    "규칙:",
    `- 오늘 날짜는 ${ctx.today} 이다. "어제", "그저께", "지난주 화요일" 같은 표현은 실제 날짜로 바꿔라.`,
    `- 이 방의 기본 가계부는 ${ctx.defaultBook}, 기본 통화는 ${ctx.defaultCurrency} 다. 문장에 단서가 없으면 book/currency 는 null 로 둬라.`,
    "- 집/가정/생활비 맥락이면 book=home, 사무실/회사/업무 맥락이면 book=office.",
    "- 금액에 '리엘/riel/៛' 이 있으면 KHR, '달러/불/$' 이면 USD, '원' 이면 KRW. 단서가 없으면 currency=null.",
    "- 돈을 썼다/샀다 = expense, 받았다/벌었다/월급 = income, 보냈다/송금 = transfer.",
    "- **한 문장에 거래가 여러 건이면 records 에 전부 넣어라.** 하나만 넣고 나머지를 버리면 안 된다.",
    "  예1) '홈 수입에 $250 추가, 후 지출 100$(아버지오토바이)'",
    "       -> records 2건: income 250 USD book=home / expense 100 USD book=home memo='아버지 오토바이'",
    "  예2) '600달러 보낸 후 800,000리엘도 보냈어' -> transfer 600 USD, transfer 800000 KHR",
    "- 앞 거래의 book 이 정해졌고 뒤 거래에 별도 언급이 없으면, 뒤 거래도 같은 book 으로 본다.",
    "- '방금/지금 입력한 것 삭제/취소' = delete_last. 몇 건인지 말하면 count 에 넣어라.",
    "- '#142 취소' 처럼 번호를 말하면 delete_id 와 entry_id.",
    "- '방금 지운 거 되살려/복구' = undo_last.",
    "- '이번달 얼마 썼어', '집계', '정산' = summary. 기간을 말하면 period 에 넣어라.",
    "- '잔액', '남은 돈' = balance.",
    "- '최근 내역', '목록' = list.",
    "- 위 어디에도 해당하지 않으면 action=chat 이다. 인사, 잡담, 질문, 상담, 감정 표현, 가계부와 무관한 모든 말이 여기 속한다.",
    "  chat 일 때는 reply 를 비워둬라. 답변은 다른 단계에서 만든다.",
    "- 돈 이야기라도 '기록/삭제/집계' 요청이 아니면 chat 이다. (예: '이번달 좀 많이 쓴 것 같지 않아?')",
    "- 절대 추측으로 금액을 지어내지 마라. 기록해달라는 뜻은 분명한데 금액이 없으면 unknown 을 써라.",
    "- 금액과 방향이 분명하면 되묻지 말고 action=record 로 처리해라. 사용자는 이미 기록을 원해서 말한 것이다.",
    "",
    ctx.recentEntries?.length
      ? `참고 - 최근 기록 (사용자가 '그거', '아까 그 pc' 처럼 가리킬 때 entry_id 를 고르는 데 쓴다):\n${ctx.recentEntries}`
      : "참고 - 최근 기록 없음.",
  ].join("\n");
}

function stripCodeFence(text) {
  return String(text || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

const pickEnum = (value, allowed) => (allowed.includes(value) ? value : null);

const pickInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** 거래 하나를 정규화한다. 금액·방향이 없으면 버린다. */
function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const amount = Number(raw.amount);
  const direction = pickEnum(raw.direction, ["expense", "income", "transfer"]);
  if (!direction || !Number.isFinite(amount) || amount <= 0) return null;

  return {
    direction,
    amount,
    currency: pickEnum(raw.currency, ["USD", "KHR", "KRW"]),
    book: pickEnum(raw.book, ["home", "office"]),
    memo: typeof raw.memo === "string" && raw.memo.trim() ? raw.memo.trim().slice(0, 200) : null,
    occurredAt: /^\d{4}-\d{2}-\d{2}$/.test(raw.occurred_at || "") ? raw.occurred_at : null,
  };
}

function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;

  const action = ACTIONS.includes(raw.action) ? raw.action : "unknown";

  // records 배열이 정식 형태지만, 모델이 예전처럼 최상위에 하나만 넣는 경우도 받아준다.
  let records = Array.isArray(raw.records) ? raw.records.map(normalizeRecord).filter(Boolean) : [];
  if (!records.length) {
    const single = normalizeRecord(raw);
    if (single) records = [single];
  }

  // 앞 거래에서 book 이 정해졌으면 뒤 거래도 같은 book 으로 이어준다.
  let inheritedBook = null;
  for (const record of records) {
    if (record.book) inheritedBook = record.book;
    else if (inheritedBook) record.book = inheritedBook;
  }

  return {
    action,
    records,
    count: pickInt(raw.count),
    entryId: pickInt(raw.entry_id),
    period: typeof raw.period === "string" && raw.period.trim() ? raw.period.trim() : null,
    reply: typeof raw.reply === "string" ? raw.reply.trim().slice(0, 300) : "",
  };
}

async function callGemini(cfg, systemPrompt, userText) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(cfg.ai.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: cfg.ai.model,
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });
  const result = await model.generateContent(userText);
  return result.response.text();
}

async function callOpenAI(cfg, systemPrompt, userText) {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: cfg.ai.openaiApiKey });
  const resp = await client.chat.completions.create({
    model: cfg.ai.fallbackModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  });
  return resp.choices?.[0]?.message?.content || "";
}

/**
 * @returns {Promise<{action:string,...}|null>} 해석 실패 시 null
 */
async function interpret(cfg, userText, ctx) {
  const systemPrompt = buildSystemPrompt(ctx);
  const errors = [];

  const providers = [];
  if (cfg.ai.geminiApiKey) providers.push(["gemini", callGemini]);
  if (cfg.ai.openaiApiKey) providers.push(["openai", callOpenAI]);

  for (const [name, call] of providers) {
    try {
      const text = await call(cfg, systemPrompt, userText);
      const parsed = JSON.parse(stripCodeFence(text));
      const normalized = normalize(parsed);
      if (normalized) return { ...normalized, provider: name };
      errors.push(`${name}: 스키마 불일치`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  const error = new Error(errors.join(" | ") || "AI 제공자가 설정되지 않았습니다.");
  error.aiFailed = true;
  throw error;
}

// ---------------------------------------------------------------- /aiok 전용 추출

function buildExtractPrompt(ctx) {
  return [
    "너는 대화 내용에서 가계부에 기록할 거래를 남김없이 뽑아내는 추출기다.",
    '설명 없이 JSON 하나만 출력한다: {"records": [...], "reply": "한 문장 요약"}',
    "",
    "records 각 원소:",
    '{"direction": "expense|income|transfer", "amount": 숫자, "currency": "USD|KHR|KRW|null",',
    ' "book": "home|office|null", "memo": "문자열|null", "occurred_at": "YYYY-MM-DD|null"}',
    "",
    "규칙:",
    `- 오늘은 ${ctx.today} 다.`,
    `- 기본 가계부는 ${ctx.defaultBook}, 기본 통화는 ${ctx.defaultCurrency} 다.`,
    "- 사용자가 방금 '그대로 기록해줘'라고 확정한 상황이다. 되묻지 말고 전부 뽑아라.",
    "- 거래가 여러 건이면 전부 넣어라. 하나만 넣고 버리면 안 된다.",
    "- 앞 거래의 book 이 정해졌고 뒤 거래에 언급이 없으면 같은 book 으로 본다.",
    "- 돈을 썼다/샀다=expense, 받았다/벌었다=income, 줬다/보냈다=transfer.",
    "- 대화에 '[기록 완료: #12, #13]' 표시가 있으면 그 거래는 이미 저장된 것이다. 다시 넣지 마라.",
    "- 대화에 금액이 없거나 이미 전부 기록됐으면 records 는 빈 배열로 두고 reply 에 이유를 적어라.",
    "- 금액을 지어내지 마라.",
  ].join("\n");
}

/**
 * 최근 대화 내용에서 거래를 뽑는다. /aiok(/저장) 에서 쓴다.
 * @returns {Promise<{records:Array, reply:string, provider:string}>}
 */
async function extractRecords(cfg, conversationText, ctx) {
  const systemPrompt = buildExtractPrompt(ctx);
  const errors = [];

  const providers = [];
  if (cfg.ai.geminiApiKey) providers.push(["gemini", callGemini]);
  if (cfg.ai.openaiApiKey) providers.push(["openai", callOpenAI]);

  for (const [name, call] of providers) {
    try {
      const parsed = JSON.parse(stripCodeFence(await call(cfg, systemPrompt, conversationText)));
      const normalized = normalize({ ...parsed, action: "record" });
      if (normalized) return { records: normalized.records, reply: normalized.reply, provider: name };
      errors.push(`${name}: 스키마 불일치`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  throw new Error(errors.join(" | ") || "AI 제공자가 설정되지 않았습니다.");
}

module.exports = { interpret, extractRecords, normalize, normalizeRecord, buildSystemPrompt, ACTIONS };
