const { splitTextForTranslation, resolveMaxChunkChars, formatPartPrefix } = require("../src/textChunker");

const longText =
  "첫 번째 문장입니다. ".repeat(40) +
  "\n\n" +
  "두 번째 단락입니다. ".repeat(40) +
  "\n\n" +
  "세 번째 단락입니다. ".repeat(40);

const maxChunk = resolveMaxChunkChars({
  model: "gemini-2.5-flash",
  fallbackModel: "gpt-5.2",
  systemPrompt: "You translate between Khmer and Korean only.",
  contextPairCount: 3,
  cfg: {},
});

const chunks = splitTextForTranslation(longText, maxChunk, 20);
console.log("maxChunkChars:", maxChunk);
console.log("inputLen:", longText.length);
console.log("chunks:", chunks.length);
chunks.forEach((c, i) => {
  console.log(`  [${i + 1}/${chunks.length}] len=${c.length} preview=${c.slice(0, 40).replace(/\n/g, "\\n")}...`);
});
console.log("prefix sample:", formatPartPrefix(2, 5) + "번역문");
