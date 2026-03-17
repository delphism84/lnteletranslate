const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");

function buildTranslationPrompt({ targetLanguage, text, contextMessages = [] }) {
  // 프롬프트 단순화 버전 (사용자가 테스트할 때 "원문 + 번역" 형태로도 잘 동작하는 수준)
  // - 너무 많은 규칙/금지사항 대신, 최소한의 품질/안전 가드만 남깁니다.
  const ctx = Array.isArray(contextMessages) ? contextMessages.filter(Boolean).slice(-3) : [];
  const ctxBlock =
    ctx.length > 0
      ? "최근 대화 3개(참고만, 번역하지 말 것):\n" +
        ctx
          .map((m) => String(m))
          .map((m) => (m.length > 220 ? m.slice(0, 220) + "…" : m))
          .map((m, i) => `${i + 1}) ${m}`)
          .join("\n") +
        "\n\n"
      : "";
  return (
    ctxBlock +
    `${targetLanguage}로 번역.\n` +
    `번역문만 출력.\n` +
    `줄바꿈/이모지 유지.\n` +
    `URL/이메일/@멘션/#해시태그/코드블록(\`\`\`)은 원문 그대로.\n\n` +
    `${text}\n\n` +
    `번역`
  );
}

function createOpenAIClient(apiKey) {
  return new OpenAI({ apiKey });
}

function createGeminiClient(apiKey) {
  return new GoogleGenerativeAI(apiKey);
}

async function translateWithGemini({ geminiClient, model, systemPrompt, targetLanguage, text, contextMessages }) {
  if (!geminiClient) throw new Error("Gemini client not configured");

  const geminiModel = geminiClient.getGenerativeModel({
    model: model === "gemini" ? "gemini-1.5-pro" : model,
    generationConfig: {
      temperature: 0.1,
    },
  });

  const prompt = `${(systemPrompt || "").trim()}\n\n${buildTranslationPrompt({ targetLanguage, text, contextMessages })}`.trim();

  const result = await geminiModel.generateContent(prompt);
  const response = await result.response;
  const translated = response.text().trim();
  return translated || "";
}

async function translateWithOpenAI({ client, model, systemPrompt, targetLanguage, text, contextMessages }) {
  if (!client) throw new Error("OpenAI client not configured");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt || "You are a translator. Return only the translation." },
      {
        role: "user",
        content: buildTranslationPrompt({ targetLanguage, text, contextMessages }),
      },
    ],
  });

  const out = resp?.choices?.[0]?.message?.content?.trim();
  return out || "";
}

async function generateWithCustomPrompt({ client, geminiClient, model, fallbackModel, systemPrompt, userContent }) {
  const primaryModel = model || "gemini-2.5-flash";
  const fallback = fallbackModel || "gpt-5.2";
  const wantsGemini = String(primaryModel).startsWith("gemini") || primaryModel === "gemini";
  console.log("[API] generateWithCustomPrompt start", { primaryModel, wantsGemini, userContentLen: (userContent || "").length });

  if (wantsGemini && geminiClient) {
    try {
      const geminiModel = geminiClient.getGenerativeModel({
        model: primaryModel === "gemini" ? "gemini-1.5-pro" : primaryModel,
        generationConfig: { temperature: 0.1 },
      });
      const prompt = `${(systemPrompt || "").trim()}\n\n${(userContent || "").trim()}`.trim();
      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      const out = response.text().trim();
      console.log("[API] generateWithCustomPrompt Gemini ok", { outLen: out.length });
      if (out) return out;
      throw new Error("Gemini returned empty");
    } catch (e) {
      console.warn("[API] generateWithCustomPrompt Gemini error", e?.message || e);
      if (client) {
        const resp = await client.chat.completions.create({
          model: fallback,
          temperature: 0.1,
          messages: [
            { role: "system", content: systemPrompt || "" },
            { role: "user", content: userContent || "" },
          ],
        });
        const out = resp?.choices?.[0]?.message?.content?.trim() || "";
        console.log("[API] generateWithCustomPrompt OpenAI fallback ok", { outLen: out.length });
        return out;
      }
      throw e;
    }
  }
  if (client) {
    const resp = await client.chat.completions.create({
      model: primaryModel,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt || "" },
        { role: "user", content: userContent || "" },
      ],
    });
    const out = resp?.choices?.[0]?.message?.content?.trim() || "";
    console.log("[API] generateWithCustomPrompt OpenAI ok", { outLen: out.length });
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
  contextMessages,
}) {
  const primaryModel = model || "gemini-2.5-flash";
  const fallback = fallbackModel || "gpt-5.2";
  console.log("[API] translateText start", {
    primaryModel,
    targetLanguage,
    textLen: (text || "").length,
    contextCount: Array.isArray(contextMessages) ? contextMessages.length : 0,
  });

  // 기본: Gemini 우선
  const wantsGemini = String(primaryModel).startsWith("gemini") || primaryModel === "gemini";

  if (wantsGemini) {
    try {
      const out = await translateWithGemini({
        geminiClient,
        model: primaryModel,
        systemPrompt,
        targetLanguage,
        text,
        contextMessages,
      });
      if (out && out.trim()) {
        console.log("[API] translateText Gemini ok", { outLen: out.trim().length });
        return out;
      }
      throw new Error("Gemini returned empty output");
    } catch (e) {
      // 결제/쿼터/일시 장애 등 -> OpenAI 폴백
      const msg = e?.message || String(e);
      console.warn("[API] translateText Gemini failed, fallback OpenAI:", msg);
      if (!client) {
        throw new Error(
          `Gemini failed and OpenAI client not configured (fallbackModel=${fallback}). Original error: ${msg}`
        );
      }
      return await translateWithOpenAI({
        client,
        model: fallback,
        systemPrompt,
        targetLanguage,
        text,
        contextMessages,
      });
    }
  }

  // OpenAI가 1차인 경우(레거시)
  const out = await translateWithOpenAI({
    client,
    model: primaryModel,
    systemPrompt,
    targetLanguage,
    text,
    contextMessages,
  });
  console.log("[API] translateText OpenAI ok", { outLen: (out || "").length });
  return out;
}

// 단어별 발음: 크메르어를 한글로 읽은 발음(한국어 뜻) 형식만. 크메르 문자 사용 금지.
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
    fallbackModel: fallbackModel || "gpt-5.2",
    systemPrompt: PRONUNCIATION_SYSTEM,
    userContent,
  });
  const result = (out || "").trim();
  console.log("[API] getPronunciationBreakdown done", { resultLen: result.length });
  return result;
}

module.exports = { createOpenAIClient, createGeminiClient, translateText, getPronunciationBreakdown };


