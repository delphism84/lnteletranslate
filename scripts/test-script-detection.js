const {
  detectScript,
  isKoreanSource,
  analyzeSourceLanguage,
} = require("../src/scriptDetection");

const cases = [
  {
    text: "OK 사랑해 내일 봐",
    expectScript: "hangul",
    expectKorean: true,
  },
  {
    text: "good morning 오늘 일찍 일어났어",
    expectScript: "hangul",
    expectKorean: true,
  },
  {
    text: "Please send money ខ្ញុំត្រូវការលុយបន្តិច",
    expectScript: "khmer",
    expectKorean: false,
  },
  {
    text: "08:00 : 정규직 출근",
    expectScript: "hangul",
    expectKorean: true,
  },
  {
    text: "USDT 100 dollars only",
    expectScript: "unknown",
    expectKorean: false,
  },
  {
    text: "ខ្ញុំស្រលាញ់អ្នក",
    expectScript: "khmer",
    expectKorean: false,
  },
  {
    text: "hello 사랑",
    expectScript: "hangul",
    expectKorean: true,
  },
];

let failed = 0;
for (const c of cases) {
  const script = detectScript(c.text, false);
  const korean = isKoreanSource(c.text);
  const analysis = analyzeSourceLanguage(c.text);
  const ok = script === c.expectScript && korean === c.expectKorean;
  if (!ok) {
    failed++;
    console.error("FAIL:", c.text);
    console.error("  got script=", script, "korean=", korean, "counts=", analysis.counts);
    console.error("  want script=", c.expectScript, "korean=", c.expectKorean);
  } else {
    console.log("OK:", c.text.slice(0, 40), "=>", script, korean, analysis.counts);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`All ${cases.length} cases passed.`);
