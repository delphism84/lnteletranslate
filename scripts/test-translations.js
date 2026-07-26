const { loadConfig } = require("./src/config");
const { createOpenAIClient, createGeminiClient, translateText } = require("./src/openaiClient");

const TEST_CASES = [
  {
    id: 1,
    label: "km→ko 부정문",
    text: "កុំពុងធ្វើម្ហូប",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["요리하지", "하지 마", "요리 중"],
  },
  {
    id: 2,
    label: "km→ko 다의어(사장)",
    text: "ខ្ចីប្រធានបានទេ",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    contextPairs: [
      {
        original: "ខ្ញុំបានប្រាប់ម្ចាស់គណនីរួចហើយ",
        translated: "저는 이미 계정 주인에게 말씀드렸어요.",
        sourceScript: "khmer",
        targetLanguage: "Korean",
      },
    ],
    expect: ["사장", "빌", "대출", "주제"],
  },
  {
    id: 3,
    label: "km→ko 짧은 긍정",
    text: "ចាស",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["네", "응", "예"],
  },
  {
    id: 4,
    label: "km→ko 의문",
    text: "តើអ្នកមកទទួលខ្ញុំបានទេ",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["데리러", "픽업", "?", "나요"],
  },
  {
    id: 5,
    label: "km→ko 돈",
    text: "មានលុយទេ",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["돈", "?"],
  },
  {
    id: 6,
    label: "km→ko 연인 호칭",
    text: "អូននឹកបង",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["보고", "그리", "사랑"],
  },
  {
    id: 7,
    label: "km→ko 아픔",
    text: ".តែអ្នកនៅតែឈឺមែនទេ",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["아프", "?", "여전"],
  },
  {
    id: 8,
    label: "km→ko 송금",
    text: "នៅឡើយទេ ប្រាក់មិនទាន់បានផ្ទេរទេ",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["송금", "아직", "돈"],
  },
  {
    id: 9,
    label: "km→ko 요리 금지(맥락)",
    text: "កុំពុងធ្វើម្ហូប",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    contextPairs: [
      {
        original: "តើអ្នកមកទទួលខ្ញុំបានទេ",
        translated: "저를 데리러 와주실 수 있나요?",
        sourceScript: "khmer",
        targetLanguage: "Korean",
      },
      {
        original: "ចាស",
        translated: "네",
        sourceScript: "khmer",
        targetLanguage: "Korean",
      },
    ],
    expect: ["요리하지", "하지 마", "요리 중"],
  },
  {
    id: 10,
    label: "km→ko 영수증",
    text: "បានផ្ញើរួចរាល់ថតវិកាយបណ័ផង",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["영수증", "보냈", "사진"],
  },
  {
    id: 11,
    label: "ko→km 송금",
    text: "아직은 돈이 송금 안 됐어요.",
    targetLanguage: "Khmer",
    sourceScript: "hangul",
    expect: ["ប្រាក់", "ផ្ទេរ"],
  },
  {
    id: 12,
    label: "ko→km 괜찮음",
    text: "괜찮아 조금 좋아졌어",
    targetLanguage: "Khmer",
    sourceScript: "hangul",
    expect: ["ល្អ", "ធូ"],
  },
  {
    id: 13,
    label: "ko→km 감사",
    text: "니 덕분에",
    targetLanguage: "Khmer",
    sourceScript: "hangul",
    expect: ["អរគុណ", "ដោយសារ"],
  },
  {
    id: 14,
    label: "ko→km 짧은",
    text: "네",
    targetLanguage: "Khmer",
    sourceScript: "hangul",
    expect: ["ចាស", "បាទ"],
  },
  {
    id: 15,
    label: "ko→km 픽업",
    text: "저를 데리러 와주실 수 있나요?",
    targetLanguage: "Khmer",
    sourceScript: "hangul",
    expect: ["ទទួល", "?", "អ្នក"],
  },
  {
    id: 16,
    label: "km→ko 시간",
    text: "ពេលប្រហែលម៉ោង1:00/2:00",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["1", "2", "시"],
  },
  {
    id: 17,
    label: "km→ko 거절",
    text: "ខ្ញុំមិនចង់",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["싶", "안"],
  },
  {
    id: 18,
    label: "km→ko 미안",
    text: "សុំទោស",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["미안", "죄송"],
  },
  {
    id: 19,
    label: "ko→km 요리하지마",
    text: "요리하지 마",
    targetLanguage: "Khmer",
    sourceScript: "hangul",
    expect: ["កុំ", "ម្ហូប", "ធ្វើ"],
  },
  {
    id: 20,
    label: "km→ko 얼마",
    text: "តើផ្ញើប៉ុន្មាន?",
    targetLanguage: "Korean",
    sourceScript: "khmer",
    expect: ["얼마", "보내", "?"],
  },
];

function scoreResult(text, expect) {
  const t = String(text || "").toLowerCase();
  const hits = (expect || []).filter((kw) => t.includes(String(kw).toLowerCase()));
  return { hits, total: (expect || []).length };
}

async function runCase(cfg, clients, tc) {
  const registerPrompts = {
    promptRegisterKhmerToKorean: cfg.promptRegisterKhmerToKorean,
    promptRegisterKoreanToKhmer: cfg.promptRegisterKoreanToKhmer,
  };
  let extra = "";
  if (tc.targetLanguage === "Khmer" && tc.sourceScript === "hangul") {
    extra = registerPrompts.promptRegisterKoreanToKhmer || "";
  } else if (tc.targetLanguage === "Korean" && tc.sourceScript === "khmer") {
    extra = registerPrompts.promptRegisterKhmerToKorean || "";
  }
  const systemPrompt = extra ? `${cfg.systemPrompt}\n\n${extra}` : cfg.systemPrompt;

  const model =
    tc.targetLanguage === "Korean" && tc.sourceScript === "khmer" && cfg.khmerToKoreanModel
      ? cfg.khmerToKoreanModel
      : tc.targetLanguage === "Khmer" && tc.sourceScript === "hangul" && cfg.koreanToKhmerModel
        ? cfg.koreanToKhmerModel
        : cfg.model;

  const t0 = Date.now();
  const out = await translateText({
    client: clients.openai,
    geminiClient: clients.gemini,
    model,
    fallbackModel: cfg.fallbackModel,
    systemPrompt,
    targetLanguage: tc.targetLanguage,
    text: tc.text,
    contextPairs: tc.contextPairs || [],
    sourceScript: tc.sourceScript,
    contextPairCount: cfg.contextPairCount,
  });
  const ms = Date.now() - t0;
  const { hits, total } = scoreResult(out, tc.expect);
  return { out, ms, hits, total };
}

async function main() {
  const cfg = loadConfig();
  const clients = {
    openai: cfg.openaiApiKey ? createOpenAIClient(cfg.openaiApiKey) : null,
    gemini: cfg.geminiApiKey ? createGeminiClient(cfg.geminiApiKey) : null,
  };

  console.log(`=== Translation test (${TEST_CASES.length} cases) ===`);
  console.log(`model=${cfg.model}, fallback=${cfg.fallbackModel}, contextPairs=${cfg.contextPairCount}\n`);

  const results = [];
  for (const tc of TEST_CASES) {
    try {
      const { out, ms, hits, total } = await runCase(cfg, clients, tc);
      const ok = hits.length > 0;
      results.push({ ...tc, out, ms, ok, hits });
      console.log(
        `[${ok ? "OK" : "??"}] #${tc.id} ${tc.label} (${ms}ms)\n` +
          `  IN : ${tc.text}\n` +
          `  OUT: ${out}\n` +
          `  KEY: ${hits.join(", ") || "(none)"} / expect any of: ${tc.expect.join(", ")}\n`
      );
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      results.push({ ...tc, out: null, ms: 0, ok: false, error: e.message });
      console.log(`[ERR] #${tc.id} ${tc.label}: ${e.message}\n`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const errCount = results.filter((r) => r.error).length;
  const avgMs = Math.round(results.filter((r) => r.ms).reduce((s, r) => s + r.ms, 0) / Math.max(1, results.length - errCount));
  console.log("=== Summary ===");
  console.log(`Pass (keyword hit): ${okCount}/${TEST_CASES.length}`);
  console.log(`Errors: ${errCount}`);
  console.log(`Avg latency: ${avgMs}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
