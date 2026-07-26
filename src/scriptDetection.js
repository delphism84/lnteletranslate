const HANGUL_RE = /[\uAC00-\uD7A3]/;
const KHMER_RE = /[\u1780-\u17FF]/;
const VIETNAMESE_RE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/;
const LATIN_RE = /[a-zA-Z]/;

function countScriptLetters(text) {
  const counts = { hangul: 0, khmer: 0, vietnamese: 0, latin: 0 };
  if (!text || typeof text !== "string") return counts;

  for (const ch of text) {
    if (HANGUL_RE.test(ch)) counts.hangul++;
    else if (KHMER_RE.test(ch)) counts.khmer++;
    else if (VIETNAMESE_RE.test(ch)) counts.vietnamese++;
    else if (LATIN_RE.test(ch)) counts.latin++;
  }

  return counts;
}

function analyzeSourceLanguage(text) {
  const counts = countScriptLetters(text);
  const ranked = [
    { source: "korean", script: "hangul", count: counts.hangul },
    { source: "khmer", script: "khmer", count: counts.khmer },
    { source: "vietnamese", script: "vietnamese", count: counts.vietnamese },
  ].filter((entry) => entry.count > 0);

  if (ranked.length === 0) {
    return { source: null, script: "unknown", counts };
  }

  ranked.sort((a, b) => b.count - a.count);
  if (ranked.length >= 2 && ranked[0].count === ranked[1].count) {
    return { source: null, script: "mixed", counts, tied: ranked.slice(0, 2) };
  }

  return { source: ranked[0].source, script: ranked[0].script, counts, dominant: ranked[0] };
}

function detectScript(text, assumeLatinIsVietnamese = false) {
  if (!text || typeof text !== "string") return "unknown";

  const cleanText = text.replace(/[\s\p{P}\p{S}\p{Emoji}]/gu, "");
  if (!cleanText) return "unknown";

  const analysis = analyzeSourceLanguage(text);
  if (analysis.script === "hangul" || analysis.script === "khmer" || analysis.script === "vietnamese") {
    return analysis.script;
  }
  if (analysis.script === "mixed") return "mixed";

  const { counts } = analysis;
  if (assumeLatinIsVietnamese && counts.latin > 0) return "vietnamese";
  return "unknown";
}

function isKoreanSource(text) {
  return analyzeSourceLanguage(text).source === "korean";
}

function formatScriptRatios(counts) {
  return `ko=${counts.hangul}, km=${counts.khmer}, vi=${counts.vietnamese}, en=${counts.latin}`;
}

module.exports = {
  countScriptLetters,
  analyzeSourceLanguage,
  detectScript,
  isKoreanSource,
  formatScriptRatios,
};
