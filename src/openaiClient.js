const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const DEFAULT_CONTEXT_PAIR_COUNT = 3;
const CONTEXT_TEXT_MAX_CHARS = 180;

function truncateContextText(text, maxLen = CONTEXT_TEXT_MAX_CHARS) {
  const s = String(text || "").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}

function scriptToLangTag(script, fallback = "?") {
  if (script === "khmer") return "km";
  if (script === "hangul") return "ko";
  if (script === "vietnamese") return "vi";
  return fallback;
}

function targetLanguageToTag(targetLanguage) {
  if (targetLanguage === "Khmer") return "km";
  if (targetLanguage === "Korean") return "ko";
  if (targetLanguage === "Vietnamese") return "vi";
  return String(targetLanguage || "?").slice(0, 2).toLowerCase();
}

function formatContextPairLine(pair, index) {
  const srcTag = scriptToLangTag(pair?.sourceScript, "?");
  const tgtTag = targetLanguageToTag(pair?.targetLanguage);
  const original = truncateContextText(pair?.original);
  const translated = truncateContextText(pair?.translated);
  return `${index + 1}) [${srcTag}] ${original} → [${tgtTag}] ${translated}`;
}

function buildTranslationPrompt({
  targetLanguage,
  text,
  contextPairs = [],
  sourceScript,
  contextPairCount = DEFAULT_CONTEXT_PAIR_COUNT,
  chunkPart = null,
  romanticKhmerRegister = false,
}) {
  const limit = Number.isFinite(contextPairCount) ? contextPairCount : DEFAULT_CONTEXT_PAIR_COUNT;
  const pairs = Array.isArray(contextPairs)
    ? contextPairs.filter((p) => p?.original && p?.translated).slice(-limit)
    : [];

  const ctxBlock =
    pairs.length > 0
      ? "Recent conversation (reference only — do NOT translate these lines; use for disambiguation, pronouns, and tone):\n" +
        pairs.map(formatContextPairLine).join("\n") +
        "\n\n"
      : "";

  const chunkBlock =
    chunkPart && chunkPart.total > 1
      ? `This is part ${chunkPart.index} of ${chunkPart.total} of a longer message. Translate ONLY this part. Maintain continuity with earlier parts in the same message.\n\n`
      : "";

  const hangulHint = romanticKhmerRegister
    ? "Source language: Korean. The listener is your Khmer-speaking girlfriend (female partner). Use warm, intimate chat phrasing as a man talking to his partner; address her naturally with អូន when appropriate. Map Korean conditionals (-면/-지면/-거든) to Khmer conditionals (បើ, ពេល, នៅពេល, ...រួច). Do NOT use completion markers (ហើយ, រួចហើយ) unless the Korean source is already past/completed.\n"
    : "Source language: Korean. Produce natural Khmer chat phrasing. Map Korean conditionals (-면/-지면/-거든) to Khmer conditionals (បើ, ពេល, នៅពេល, ...រួច). Do NOT use completion markers (ហើយ, រួចហើយ) unless the Korean source is already past/completed.\n";
  const sourceHint =
    sourceScript === "khmer"
      ? "Source language: Khmer. Preserve negation (កុំ), question particles (ទេ/អត់), and honorifics (អូន/បង) accurately in Korean.\n"
      : sourceScript === "hangul"
        ? hangulHint
        : "";

  return (
    ctxBlock +
    chunkBlock +
    sourceHint +
    `Translate the following text into ${targetLanguage}.\n` +
    `Output only the translation.\n` +
    `Preserve line breaks and emojis.\n` +
    `Keep URLs, emails, @mentions, #hashtags, and code blocks (\`\`\`) unchanged.\n\n` +
    `${text}\n\n` +
    `Translation`
  );
}

function createOpenAIClient(apiKey) {
  return new OpenAI({ apiKey });
}

function createGeminiClient(apiKey) {
  return new GoogleGenerativeAI(apiKey);
}

async function translateWithGemini({
  geminiClient,
  model,
  systemPrompt,
  targetLanguage,
  text,
  contextPairs,
  sourceScript,
  contextPairCount,
  chunkPart,
  romanticKhmerRegister,
}) {
  if (!geminiClient) throw new Error("Gemini client not configured");

  const geminiModel = geminiClient.getGenerativeModel({
    model: model === "gemini" ? "gemini-1.5-pro" : model,
    generationConfig: {
      temperature: 0.1,
    },
  });

  const prompt = `${(systemPrompt || "").trim()}\n\n${buildTranslationPrompt({
    targetLanguage,
    text,
    contextPairs,
    sourceScript,
    contextPairCount,
    chunkPart,
    romanticKhmerRegister,
  })}`.trim();

  const resolvedModel = model === "gemini" ? "gemini-1.5-pro" : model;
  const t0 = Date.now();
  try {
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    const translated = response.text().trim();
    const ms = Date.now() - t0;
    console.log("[API] translateWithGemini", {
      ms,
      model: resolvedModel,
      targetLanguage,
      textLen: (text || "").length,
      outLen: translated.length,
      contextPairs: Array.isArray(contextPairs) ? contextPairs.length : 0,
    });
    return translated || "";
  } catch (e) {
    const ms = Date.now() - t0;
    console.warn("[API] translateWithGemini error", {
      ms,
      model: resolvedModel,
      targetLanguage,
      err: e?.message || String(e),
    });
    throw e;
  }
}

async function translateWithOpenAI({
  client,
  model,
  systemPrompt,
  targetLanguage,
  text,
  contextPairs,
  sourceScript,
  contextPairCount,
  chunkPart,
  romanticKhmerRegister,
}) {
  if (!client) throw new Error("OpenAI client not configured");

  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt || "You are a translator. Return only the translation." },
      {
        role: "user",
        content: buildTranslationPrompt({
          targetLanguage,
          text,
          contextPairs,
          sourceScript,
          contextPairCount,
          chunkPart,
          romanticKhmerRegister,
        }),
      },
    ],
  });

  const out = resp?.choices?.[0]?.message?.content?.trim();
  const ms = Date.now() - t0;
  console.log("[API] translateWithOpenAI", {
    ms,
    model,
    targetLanguage,
    textLen: (text || "").length,
    outLen: (out || "").length,
    contextPairs: Array.isArray(contextPairs) ? contextPairs.length : 0,
  });
  return out || "";
}

async function generateWithCustomPrompt({ client, geminiClient, model, fallbackModel, systemPrompt, userContent }) {
  const primaryModel = model || "gemini-2.5-flash";
  const fallback =
    fallbackModel != null && String(fallbackModel).trim() ? String(fallbackModel).trim() : null;
  const wantsGemini = String(primaryModel).startsWith("gemini") || primaryModel === "gemini";
  console.log("[API] generateWithCustomPrompt start", { primaryModel, wantsGemini, userContentLen: (userContent || "").length });

  if (wantsGemini && geminiClient) {
    try {
      const geminiModel = geminiClient.getGenerativeModel({
        model: primaryModel === "gemini" ? "gemini-1.5-pro" : primaryModel,
        generationConfig: { temperature: 0.1 },
      });
      const prompt = `${(systemPrompt || "").trim()}\n\n${(userContent || "").trim()}`.trim();
      const t0 = Date.now();
      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      const out = response.text().trim();
      const ms = Date.now() - t0;
      console.log("[API] generateWithCustomPrompt Gemini ok", { ms, outLen: out.length });
      if (out) return out;
      throw new Error("Gemini returned empty");
    } catch (e) {
      console.warn("[API] generateWithCustomPrompt Gemini error", e?.message || e);
      if (fallback && client) {
        const t0 = Date.now();
        const resp = await client.chat.completions.create({
          model: fallback,
          temperature: 0.1,
          messages: [
            { role: "system", content: systemPrompt || "" },
            { role: "user", content: userContent || "" },
          ],
        });
        const out = resp?.choices?.[0]?.message?.content?.trim() || "";
        const ms = Date.now() - t0;
        console.log("[API] generateWithCustomPrompt OpenAI fallback ok", { ms, outLen: out.length });
        return out;
      }
      throw e;
    }
  }
  if (client && !String(primaryModel).startsWith("gemini") && primaryModel !== "gemini") {
    const t0 = Date.now();
    const resp = await client.chat.completions.create({
      model: primaryModel,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt || "" },
        { role: "user", content: userContent || "" },
      ],
    });
    const out = resp?.choices?.[0]?.message?.content?.trim() || "";
    const ms = Date.now() - t0;
    console.log("[API] generateWithCustomPrompt OpenAI ok", { ms, outLen: out.length });
    return out;
  }
  console.warn("[API] generateWithCustomPrompt no client");
  return "";
}

async function translateText({
  client,
  geminiClient,
  model,
  fallbackModel,
  systemPrompt,
  targetLanguage,
  text,
  contextPairs,
  sourceScript,
  contextPairCount,
  chunkPart,
  romanticKhmerRegister,
}) {
  const primaryModel = model || "gemini-2.5-flash";
  const fallback =
    fallbackModel != null && String(fallbackModel).trim() ? String(fallbackModel).trim() : null;
  const pairCount = Array.isArray(contextPairs) ? contextPairs.length : 0;
  console.log("[API] translateText start", {
    primaryModel,
    fallback: fallback || "none",
    targetLanguage,
    textLen: (text || "").length,
    contextPairCount: pairCount,
    chunkPart: chunkPart ? `${chunkPart.index}/${chunkPart.total}` : null,
  });

  const wantsGemini = String(primaryModel).startsWith("gemini") || primaryModel === "gemini";
  const translateOpts = {
    systemPrompt,
    targetLanguage,
    text,
    contextPairs,
    sourceScript,
    contextPairCount,
    chunkPart,
    romanticKhmerRegister,
  };

  if (wantsGemini) {
    try {
      const out = await translateWithGemini({
        geminiClient,
        model: primaryModel,
        ...translateOpts,
      });
      if (out && out.trim()) {
        console.log("[API] translateText Gemini ok", { outLen: out.trim().length });
        return out;
      }
      throw new Error("Gemini returned empty output");
    } catch (e) {
      const msg = e?.message || String(e);
      if (!fallback || !client) {
        console.warn("[API] translateText Gemini failed (no fallback):", msg);
        throw e;
      }
      console.warn("[API] translateText Gemini failed, fallback OpenAI:", msg);
      return await translateWithOpenAI({
        client,
        model: fallback,
        ...translateOpts,
      });
    }
  }

  const out = await translateWithOpenAI({
    client,
    model: primaryModel,
    ...translateOpts,
  });
  console.log("[API] translateText OpenAI ok", { outLen: (out || "").length });
  return out;
}

async function translateTextInChunks({
  client,
  geminiClient,
  model,
  fallbackModel,
  systemPrompt,
  targetLanguage,
  text,
  contextPairs,
  sourceScript,
  contextPairCount,
  maxChunkChars,
  maxChunks,
  romanticKhmerRegister,
}) {
  const { splitTextForTranslation } = require("./textChunker");
  const chunks = splitTextForTranslation(text, maxChunkChars, maxChunks);
  const total = chunks.length;

  if (total <= 1) {
    const translated = await translateText({
      client,
      geminiClient,
      model,
      fallbackModel,
      systemPrompt,
      targetLanguage,
      text,
      contextPairs,
      sourceScript,
      contextPairCount,
      chunkPart: null,
      romanticKhmerRegister,
    });
    return [{ part: 1, total: 1, translated: translated || "" }];
  }

  console.log("[API] translateTextInChunks", {
    total,
    maxChunkChars,
    textLen: (text || "").length,
  });

  const results = [];
  const inMessagePairs = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const chunkContext =
      i === 0
        ? contextPairs
        : [
            ...(Array.isArray(contextPairs) ? contextPairs : []),
            ...inMessagePairs.map((p) => ({
              original: p.original,
              translated: p.translated,
              sourceScript,
              targetLanguage,
            })),
          ];

    const translated = await translateText({
      client,
      geminiClient,
      model,
      fallbackModel,
      systemPrompt,
      targetLanguage,
      text: chunkText,
      contextPairs: chunkContext,
      sourceScript,
      contextPairCount,
      chunkPart: { index: i + 1, total },
      romanticKhmerRegister,
    });

    const cleaned = (translated || "").trim();
    if (!cleaned) {
      throw new Error(`Chunk ${i + 1}/${total} returned empty translation`);
    }

    results.push({ part: i + 1, total, translated: cleaned });
    inMessagePairs.push({ original: chunkText, translated: cleaned });
  }

  return results;
}

const PRONUNCIATION_SYSTEM =
  "You are a specialist in Khmer and Korean. For the given Khmer text, output exactly one line. Each word or short phrase must be written as '한글발음(한국어뜻)' — the first part is how to read the Khmer word in Korean letters (한글 only, no Khmer script), the part in parentheses is the meaning in Korean. Use a space between items. Example: 크뇸(나는) 반(추가했다) 번텀(기능을) 모꺙하(보여주기). Do NOT use Khmer script in the output. Output only this single line, no translation sentence, no explanation.";

async function getPronunciationBreakdown({
  client,
  geminiClient,
  model,
  fallbackModel,
  text,
}) {
  const userContent = (text || "").trim();
  if (!userContent) {
    console.log("[API] getPronunciationBreakdown skip empty text");
    return "";
  }
  console.log("[API] getPronunciationBreakdown call", { textLen: userContent.length, model });
  const out = await generateWithCustomPrompt({
    client,
    geminiClient,
    model: model || "gemini-2.5-flash",
    fallbackModel: fallbackModel != null && String(fallbackModel).trim() ? fallbackModel : null,
    systemPrompt: PRONUNCIATION_SYSTEM,
    userContent,
  });
  const result = (out || "").trim();
  console.log("[API] getPronunciationBreakdown done", { resultLen: result.length });
  return result;
}

module.exports = {
  createOpenAIClient,
  createGeminiClient,
  translateText,
  translateTextInChunks,
  getPronunciationBreakdown,
};
