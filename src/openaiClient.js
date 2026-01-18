const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");

function createOpenAIClient(apiKey) {
  return new OpenAI({ apiKey });
}

function createGeminiClient(apiKey) {
  return new GoogleGenerativeAI(apiKey);
}

async function translateWithGemini({ geminiClient, model, systemPrompt, targetLanguage, text }) {
  if (!geminiClient) throw new Error("Gemini client not configured");

  const geminiModel = geminiClient.getGenerativeModel({
    model: model === "gemini" ? "gemini-1.5-pro" : model,
    generationConfig: {
      temperature: 0.1,
    },
  });

  const prompt = `${systemPrompt}\n\nTranslate the following text into ${targetLanguage}. You must translate every word and character, including short phrases, single words, and text with special characters. Do not skip translation even if the text is short or contains unusual characters. Always provide a translation in ${targetLanguage}. If the text is already in ${targetLanguage}, return it naturally without modification. Output only the translation without quotes or additional text.\n\nText to translate: ${text}`;

  const result = await geminiModel.generateContent(prompt);
  const response = await result.response;
  const translated = response.text().trim();
  return translated || "";
}

async function translateWithOpenAI({ client, model, systemPrompt, targetLanguage, text }) {
  if (!client) throw new Error("OpenAI client not configured");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `Translate the following text into ${targetLanguage}. ` +
          "You must translate every word and character, including short phrases, single words, and text with special characters. " +
          "Do not skip translation even if the text is short or contains unusual characters. " +
          "Always provide a translation in ${targetLanguage}. " +
          "If the text is already in ${targetLanguage}, return it naturally without modification. " +
          "Output only the translation without quotes or additional text.\n\n" +
          `Text to translate: ${text}`,
      },
    ],
  });

  const out = resp?.choices?.[0]?.message?.content?.trim();
  return out || "";
}

async function translateText({
  client,
  geminiClient,
  model,
  fallbackModel,
  systemPrompt,
  targetLanguage,
  text,
}) {
  const primaryModel = model || "gemini-2.5-flash";
  const fallback = fallbackModel || "gpt-5.2";

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
      });
      if (out && out.trim()) return out;
      throw new Error("Gemini returned empty output");
    } catch (e) {
      // 결제/쿼터/일시 장애 등 -> OpenAI 폴백
      const msg = e?.message || String(e);
      console.warn("[tele-translate] gemini failed, falling back to OpenAI:", msg);
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
      });
    }
  }

  // OpenAI가 1차인 경우(레거시)
  return await translateWithOpenAI({
    client,
    model: primaryModel,
    systemPrompt,
    targetLanguage,
    text,
  });
}

module.exports = { createOpenAIClient, createGeminiClient, translateText };


