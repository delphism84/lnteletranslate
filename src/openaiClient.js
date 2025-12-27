const OpenAI = require("openai");

function createOpenAIClient(apiKey) {
  return new OpenAI({ apiKey });
}

async function translateText({ client, model, systemPrompt, targetLanguage, text }) {
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `Translate the following text into ${targetLanguage}. ` +
          "If it's already in that language, return it naturally. " +
          "Do not add quotes or extra commentary.\n\n" +
          text,
      },
    ],
  });

  const out = resp?.choices?.[0]?.message?.content?.trim();
  return out || "";
}

module.exports = { createOpenAIClient, translateText };


