const { loadConfig } = require("./src/config");
const { createOpenAIClient, createGeminiClient, translateText } = require("./src/openaiClient");

const KO_TO_KM_CASES = [
  {
    id: 1,
    label: "조건: 보내지면 영수증",
    text: "돈이 보내지면 너에게 영수증을 보내줄게",
    kind: "conditional",
    bad: [/លុយ.*ផ្ញើ.*ហើយ/i, /^ផ្ញើ.*ហើយ/i],
    good: [/បើ|ពេល|នៅពេល|រួច/i],
  },
  {
    id: 2,
    label: "조건: 만나면 밥",
    text: "만나면 밥 먹자",
    kind: "conditional",
    bad: [/ជួប.*ហើយ/i],
    good: [/បើ|ពេល|នៅពេល|រួច/i],
  },
  {
    id: 3,
    label: "조건: 시간 되면 연락",
    text: "시간 되면 연락해",
    kind: "conditional",
    bad: [],
    good: [/បើ|ពេល|ទាក់ទង/i],
  },
  {
    id: 4,
    label: "조건: 돈 받으면 알려",
    text: "돈 받으면 알려줘",
    kind: "conditional",
    bad: [/ទទួល.*ហើយ.*ប្រាប/i],
    good: [/បើ|ពេល|ប្រាប/i],
  },
  {
    id: 5,
    label: "조건: 내일 가면 연락",
    text: "내일 가면 연락할게",
    kind: "conditional",
    bad: [],
    good: [/បើ|ពេល|ទាក់ទង/i],
  },
  {
    id: 6,
    label: "조건: 괜찮으면 그렇게",
    text: "괜찮으면 그렇게 해",
    kind: "conditional",
    bad: [],
    good: [/បើ|ពេល|ល្អ/i],
  },
  {
    id: 7,
    label: "조건: 송금하면 확인",
    text: "송금하면 확인해줘",
    kind: "conditional",
    bad: [/ផ្ទេរ.*ហើយ/i],
    good: [/បើ|ពេល|ផ្ទេរ/i],
  },
  {
    id: 8,
    label: "완료: 이미 보냈어",
    text: "이미 보냈어",
    kind: "completed",
    bad: [/បើ|ពេល/i],
    good: [/ហើយ|រួច|ផ្ញើ/i],
  },
  {
    id: 9,
    label: "완료: 송금 안 됐어",
    text: "아직은 돈이 송금 안 됐어요.",
    kind: "negative",
    bad: [/ហើយ.*ផ្ទេរ/i],
    good: [/មិន|អត់|ទេ/i],
  },
  {
    id: 10,
    label: "일반: 괜찮아",
    text: "괜찮아 조금 좋아졌어",
    kind: "general",
    bad: [],
    good: [/ល្អ|ធូ|ស្រ/i],
  },
  {
    id: 11,
    label: "일반: 니 덕분에",
    text: "니 덕분에",
    kind: "general",
    bad: [],
    good: [/អរគុណ|ដោយ/i],
  },
  {
    id: 12,
    label: "일반: 네",
    text: "네",
    kind: "general",
    bad: [],
    good: [/ចាស|បាទ|អូ/i],
  },
  {
    id: 13,
    label: "일반: 픽업",
    text: "저를 데리러 와주실 수 있나요?",
    kind: "general",
    bad: [],
    good: [/ទទួល|\?/],
  },
  {
    id: 14,
    label: "명령: 요리하지마",
    text: "요리하지 마",
    kind: "imperative",
    bad: [],
    good: [/កុំ|ម្ហូប/i],
  },
  {
    id: 15,
    label: "일반: 보고싶어",
    text: "오빠 보고 싶어",
    kind: "general",
    bad: [],
    good: [/នឹក|រំ/i],
  },
  {
    id: 16,
    label: "일반: 미안",
    text: "미안해",
    kind: "general",
    bad: [],
    good: [/សុំទោស|អត់/i],
  },
  {
    id: 17,
    label: "일반: 아직 안 했어",
    text: "아직 안 했어",
    kind: "negative",
    bad: [/ហើយ/i],
    good: [/មិន|អត់|ទេ/i],
  },
  {
    id: 18,
    label: "일반: 보내주세요",
    text: "보내주세요",
    kind: "general",
    bad: [],
    good: [/ផ្ញើ/i],
  },
  {
    id: 19,
    label: "일반: 언제 올거야",
    text: "언제 올 거야?",
    kind: "general",
    bad: [],
    good: [/\?|ម៉ោង|ពេល/i],
  },
  {
    id: 20,
    label: "일반: 전화할게",
    text: "좀 있다가 전화할게",
    kind: "general",
    bad: [],
    good: [/ទូរស|ហៅ/i],
  },
];

function buildSystemPrompt(cfg) {
  return `${cfg.systemPrompt}\n\n${cfg.promptRegisterKoreanToKhmer}`;
}

function scoreOutput(out, tc) {
  const t = String(out || "");
  const badHit = (tc.bad || []).some((re) => re.test(t));
  const goodHit = (tc.good || []).length === 0 || (tc.good || []).some((re) => re.test(t));
  const ok = !badHit && goodHit;
  return { ok, badHit, goodHit };
}

async function runModel(modelName, cfg, clients, tc) {
  const wantsGemini = String(modelName).startsWith("gemini");
  const out = await translateText({
    client: clients.openai,
    geminiClient: clients.gemini,
    model: modelName,
    fallbackModel: null,
    systemPrompt: buildSystemPrompt(cfg),
    targetLanguage: "Khmer",
    text: tc.text,
    contextPairs: [],
    sourceScript: "hangul",
    contextPairCount: cfg.contextPairCount,
    chunkPart: null,
  });
  return (out || "").trim();
}

async function main() {
  const cfg = loadConfig();
  const clients = {
    openai: cfg.openaiApiKey ? createOpenAIClient(cfg.openaiApiKey) : null,
    gemini: cfg.geminiApiKey ? createGeminiClient(cfg.geminiApiKey) : null,
  };

  const models = [
    { name: "gemini-2.5-flash", label: "Gemini" },
    { name: "gpt-5.2", label: "GPT" },
  ];

  console.log("=== ko→km model comparison (20 cases) ===\n");
  const summary = { Gemini: 0, GPT: 0 };

  for (const tc of KO_TO_KM_CASES) {
    console.log(`#${tc.id} ${tc.label}`);
    console.log(`  IN: ${tc.text}`);
    for (const m of models) {
      try {
        const out = await runModel(m.name, cfg, clients, tc);
        const { ok } = scoreOutput(out, tc);
        if (ok) summary[m.label]++;
        console.log(`  ${m.label}: ${ok ? "OK" : "??"} | ${out}`);
        await new Promise((r) => setTimeout(r, 600));
      } catch (e) {
        console.log(`  ${m.label}: ERR | ${e.message}`);
      }
    }
    console.log("");
  }

  console.log("=== Summary (heuristic pass) ===");
  console.log(`Gemini: ${summary.Gemini}/20`);
  console.log(`GPT:    ${summary.GPT}/20`);
  console.log(`Production routing: ko→km=${cfg.koreanToKhmerModel || cfg.model}, km→ko=${cfg.model}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
