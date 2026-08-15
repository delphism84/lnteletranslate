// tra 그룹의 지난 대화 로그를 분석해 '자동 추출'이 실제로 쓸 만한지 가늠한다.
//
//   1단계  정규식으로 금액 단서가 있는 메시지만 추린다 (LLM 비용 결정 요인)
//   2단계  추려낸 것만 AI 에 넣어 '진짜 거래'인지 판정한다 (정밀도 결정 요인)
//
// 사용법:
//   node scripts/analyze-history.js --days=7            # 1단계만
//   node scripts/analyze-history.js --days=7 --ai       # 2단계까지
//   node scripts/analyze-history.js --days=7 --ai --limit=40
//
// 주의: 컨테이너 로그의 원문은 50자로 잘려 있다. 긴 메시지는 뒷부분이 없다.

const { execFileSync } = require("child_process");
const { loadConfig } = require("../src/config");

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const DAYS = Number(getArg("days", 7));
const CONTAINER = getArg("container", "lnteletranslate-tra");
const USE_AI = args.includes("--ai");
const LIMIT = Number(getArg("limit", 0));
const BATCH = Number(getArg("batch", 10));

// ---------------------------------------------------------------- 로그 파싱

const RE_PROCESSING = /^(\S+) \[\w+\] \[message\] Processing: "([\s\S]*?)\.\.\." => (\w+) \[script: (\w+)/;
const RE_TRANSLATION = /^(\S+) \[\w+\] \[message\] Translation part (\d+)\/(\d+): "([\s\S]*?)\.\.\."$/;

function readMessages() {
  const raw = execFileSync(
    "docker",
    ["logs", "-t", "--since", `${DAYS * 24}h`, CONTAINER],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
  );

  const messages = [];
  let pending = null;

  for (const line of raw.split("\n")) {
    const proc = RE_PROCESSING.exec(line);
    if (proc) {
      pending = {
        ts: proc[1],
        original: proc[2],
        targetLanguage: proc[3],
        script: proc[4],
        translation: "",
      };
      messages.push(pending);
      continue;
    }

    const trans = RE_TRANSLATION.exec(line);
    if (trans && pending) {
      pending.translation += (pending.translation ? " " : "") + trans[4];
      if (Number(trans[2]) === Number(trans[3])) pending = null; // 마지막 파트
    }
  }

  return messages;
}

// ---------------------------------------------------------------- 정규식 필터

// 숫자 바로 옆에 통화 표시가 붙은 강한 단서
const STRONG = [
  /[$៛₩]\s*[\d០-៩]/,
  /[\d០-៩]\s*[$៛₩]/,
  /[\d០-៩][\d០-៩,.]*\s*(원|달러|불|리엘|만원|천원)/,
  /[\d០-៩][\d០-៩,.]*\s*(usd|krw|khr|riel|dollar|dollars|won)\b/i,
  /(រៀល|ដុល្លារ)/,
];

// 통화 표시 없이 숫자만 큰 것 — 시각·날짜·전화번호도 섞여 들어온다
const WEAK = /(?:^|[^\d])[\d០-៩]{3,}(?:[^\d]|$)/;

function classify(text) {
  const haystack = `${text.original} ${text.translation}`;
  if (STRONG.some((re) => re.test(haystack))) return "strong";
  if (WEAK.test(haystack)) return "weak";
  return "none";
}

// ---------------------------------------------------------------- AI 판정

const AI_SYSTEM = [
  "너는 커플의 일상 대화에서 '실제로 일어난 돈 거래'만 골라내는 분류기다.",
  "각 메시지에 대해 JSON 배열 한 개만 출력한다. 설명·코드블록 금지.",
  "",
  "각 원소:",
  `{"i": 입력 번호, "is_transaction": true/false, "direction": "expense|income|transfer|null", "amount": 숫자|null, "currency": "USD|KHR|KRW|null", "memo": "짧은 한국어"|null, "confidence": 0~1, "why": "판단 근거 10자 이내"}`,
  "",
  "is_transaction = true 인 경우는 이것뿐이다:",
  "- 화자가 실제로 돈을 썼다/샀다/받았다/보냈다고 말한 것 (완료된 사실)",
  "",
  "false 로 둬야 하는 것 (중요):",
  "- 가격을 묻거나 알려주는 말 ('그거 얼마야', '400~500달러 정도야')",
  "- 앞으로 할 계획·의사 ('사줄게', '보낼게', '사고 싶어')",
  "- 조건·가정 ('보내고 싶으면 100달러', '있으면 살 텐데')",
  "- 부탁·요구 ('돈 보내줘', '100달러 줘')",
  "- 남의 거래나 일반적인 이야기",
  "- 금액이 아닌 숫자 (시각, 날짜, 나이, 전화번호, 개수)",
  "",
  "확신이 없으면 is_transaction=false 로 둬라. 놓치는 것보다 잘못 기록하는 게 나쁘다.",
].join("\n");

async function callAI(cfg, batch) {
  const userText = batch
    .map((m, i) => `${i}. [원문] ${m.original}\n   [번역] ${m.translation || "(없음)"}`)
    .join("\n");

  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(cfg.ai.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: cfg.ai.model,
    systemInstruction: AI_SYSTEM,
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });

  const result = await model.generateContent(userText);
  const text = result.response
    .text()
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed.results || [];
}

// ---------------------------------------------------------------- 실행

async function main() {
  const cfg = loadConfig();

  console.log(`\n=== tra 그룹 대화 분석 (최근 ${DAYS}일) ===\n`);

  const messages = readMessages();
  console.log(`전체 메시지        ${messages.length}건`);
  if (!messages.length) {
    console.log("로그에서 메시지를 찾지 못했습니다.");
    return;
  }
  console.log(`기간               ${messages[0].ts.slice(0, 19)} ~ ${messages[messages.length - 1].ts.slice(0, 19)}`);

  const buckets = { strong: [], weak: [], none: [] };
  for (const m of messages) buckets[classify(m)].push(m);

  const pct = (n) => `${((n / messages.length) * 100).toFixed(1)}%`;
  console.log("\n--- 1단계: 정규식 필터 ---");
  console.log(`통화기호+숫자 (강) ${buckets.strong.length}건  ${pct(buckets.strong.length)}   <- AI 호출 대상`);
  console.log(`숫자만 (약)        ${buckets.weak.length}건  ${pct(buckets.weak.length)}   <- 시각·날짜 등 노이즈 다수`);
  console.log(`금액 단서 없음     ${buckets.none.length}건  ${pct(buckets.none.length)}   <- 무료로 걸러짐`);

  const perDay = (buckets.strong.length / DAYS).toFixed(1);
  console.log(`\n강한 단서 기준 하루 평균 ${perDay}건 -> AI 호출 비용은 무시할 수준`);

  console.log("\n--- 강한 단서 샘플 (최대 15건) ---");
  for (const m of buckets.strong.slice(0, 15)) {
    console.log(`  ${m.ts.slice(5, 16)}  ${m.original.slice(0, 42)}`);
    if (m.translation) console.log(`               -> ${m.translation.slice(0, 42)}`);
  }

  if (!USE_AI) {
    console.log("\n(--ai 를 붙이면 2단계 AI 판정까지 실행합니다)");
    return;
  }

  // --- 2단계 -------------------------------------------------------------
  let targets = buckets.strong;
  if (LIMIT > 0) targets = targets.slice(-LIMIT); // 최근 것 우선

  console.log(`\n--- 2단계: AI 판정 (${targets.length}건, ${BATCH}건씩) ---\n`);

  const verdicts = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    try {
      const results = await callAI(cfg, batch);
      for (const r of results) {
        const source = batch[Number(r.i)];
        if (source) verdicts.push({ ...r, source });
      }
      process.stdout.write(`  ${Math.min(i + BATCH, targets.length)}/${targets.length}\r`);
    } catch (err) {
      console.error(`\n  배치 ${i} 실패: ${err.message}`);
    }
  }

  const hits = verdicts.filter((v) => v.is_transaction);
  const confident = hits.filter((v) => Number(v.confidence) >= 0.8);

  console.log(`\n\n판정 완료          ${verdicts.length}건`);
  console.log(`실제 거래로 판정   ${hits.length}건  (${((hits.length / (verdicts.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`확신도 0.8 이상    ${confident.length}건`);
  console.log(`거래 아님          ${verdicts.length - hits.length}건  <- 확인 버튼 없이 자동저장했다면 전부 오염`);

  console.log("\n--- 거래로 판정된 것 ---");
  for (const v of hits) {
    const money = v.amount ? `${v.amount} ${v.currency || "?"}` : "?";
    console.log(`  [${Number(v.confidence).toFixed(2)}] ${v.direction} ${money} "${v.memo || ""}"`);
    console.log(`         원문: ${v.source.original.slice(0, 46)}`);
    if (v.source.translation) console.log(`         번역: ${v.source.translation.slice(0, 46)}`);
  }

  console.log("\n--- 거래 아님으로 걸러진 것 (샘플 12건) ---");
  for (const v of verdicts.filter((x) => !x.is_transaction).slice(0, 12)) {
    console.log(`  (${v.why || "-"}) ${v.source.translation || v.source.original}`.slice(0, 100));
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
