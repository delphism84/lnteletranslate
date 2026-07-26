const MODEL_CHUNK_CHARS = {
  "gemini-2.5-flash": 1100,
  "gemini-2.5-pro": 1100,
  "gemini-2.0-flash": 1100,
  "gpt-5.2": 2200,
  "gpt-4.1": 2200,
  "gpt-4o": 2200,
  default: 1100,
};

function isGeminiModel(model) {
  return String(model || "").startsWith("gemini") || model === "gemini";
}

function resolveMaxChunkChars({ model, fallbackModel, cfg }) {
  if (Number.isFinite(cfg?.maxChunkChars) && cfg.maxChunkChars > 200) {
    return cfg.maxChunkChars;
  }

  const primary = model || cfg?.model || "gemini-2.5-flash";
  const fallback =
    fallbackModel != null && String(fallbackModel).trim()
      ? fallbackModel
      : cfg?.fallbackModel != null && String(cfg.fallbackModel).trim()
        ? cfg.fallbackModel
        : null;
  const geminiLimit = MODEL_CHUNK_CHARS[primary] || MODEL_CHUNK_CHARS.default;

  if (isGeminiModel(primary)) {
    if (!fallback) return geminiLimit;
    const openaiLimit = MODEL_CHUNK_CHARS[fallback] || MODEL_CHUNK_CHARS["gpt-5.2"];
    return Math.min(geminiLimit, openaiLimit);
  }
  if (fallback) {
    return MODEL_CHUNK_CHARS[fallback] || MODEL_CHUNK_CHARS["gpt-5.2"];
  }
  return MODEL_CHUNK_CHARS[primary] || geminiLimit;
}

function hardSplit(text, maxLen) {
  const chunks = [];
  let rest = String(text || "");
  while (rest.length > maxLen) {
    chunks.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function splitByDelimiter(text, delimiter, maxLen) {
  const parts = String(text || "").split(delimiter);
  const chunks = [];
  let buf = "";

  const flush = () => {
    if (buf) {
      chunks.push(buf);
      buf = "";
    }
  };

  for (let i = 0; i < parts.length; i++) {
    const piece = i < parts.length - 1 ? parts[i] + delimiter : parts[i];
    if (!piece) continue;

    if (piece.length > maxLen) {
      flush();
      chunks.push(...hardSplit(piece, maxLen));
      continue;
    }

    const candidate = buf ? buf + piece : piece;
    if (candidate.length <= maxLen) {
      buf = candidate;
    } else {
      flush();
      buf = piece;
    }
  }
  flush();
  return chunks;
}

function splitBySentence(text, maxLen) {
  const sentencePattern = /(?<=[.!?…。！？]\s*|\n+)/u;
  const sentences = String(text || "").split(sentencePattern).filter(Boolean);
  if (sentences.length <= 1) return null;

  const chunks = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
  };

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (piece.length > maxLen) {
      flush();
      chunks.push(...hardSplit(piece, maxLen));
      continue;
    }
    const candidate = buf ? `${buf} ${piece}` : piece;
    if (candidate.length <= maxLen) {
      buf = candidate;
    } else {
      flush();
      buf = piece;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : null;
}

function splitTextForTranslation(text, maxChunkChars, maxChunks = 20) {
  const raw = String(text || "");
  if (!raw.trim()) return [raw];
  if (raw.length <= maxChunkChars) return [raw];

  let chunks = splitByDelimiter(raw, "\n\n", maxChunkChars);
  if (chunks.length === 1 && raw.includes("\n")) {
    chunks = splitByDelimiter(raw, "\n", maxChunkChars);
  }
  if (chunks.length === 1) {
    const bySentence = splitBySentence(raw, maxChunkChars);
    if (bySentence) chunks = bySentence;
  }
  if (chunks.length === 1 && raw.length > maxChunkChars) {
    chunks = hardSplit(raw, maxChunkChars);
  }

  if (chunks.length > maxChunks) {
    const merged = [];
    const groupSize = Math.ceil(chunks.length / maxChunks);
    for (let i = 0; i < chunks.length; i += groupSize) {
      merged.push(chunks.slice(i, i + groupSize).join("\n"));
    }
    chunks = merged;
  }

  return chunks.filter((c) => c && c.trim());
}

function formatPartPrefix(part, total) {
  if (!total || total <= 1) return "";
  return `(${part}/${total}) `;
}

module.exports = {
  splitTextForTranslation,
  resolveMaxChunkChars,
  formatPartPrefix,
  MODEL_CHUNK_CHARS,
};
