const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

// Ensure data/ exists at startup
const DATA_DIR = path.join(__dirname, "data");
const CHUNKS_PATH = path.join(DATA_DIR, "chunks.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage() });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Split text into overlapping chunks (~500 words each, 50-word overlap)
function splitIntoChunks(text, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
    i += chunkSize - overlap;
  }
  return chunks;
}

// Score chunks by keyword overlap with the question
function searchChunks(question, chunks, topK = 5) {
  const stopWords = new Set(["the", "is", "are", "was", "were", "a", "an", "and", "or", "of", "in", "to", "for", "with", "that", "this", "it", "on", "at", "by", "as", "be"]);
  const questionWords = new Set(
    question.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w))
  );

  if (questionWords.size === 0) return chunks.slice(0, topK);

  return chunks
    .map(chunk => {
      const chunkWords = chunk.text.toLowerCase().split(/\s+/);
      const score = chunkWords.filter(w => questionWords.has(w)).length;
      return { ...chunk, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── POST /upload-pdfs ───────────────────────────────────────────────────────
// Accepts up to 10 PDF files, extracts text, splits into chunks, saves chunks.json
app.post("/upload-pdfs", upload.array("pdfs", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.json({ success: false, message: "No PDF files received" });
    }

    const allChunks = [];

    for (const file of req.files) {
      const data = await pdfParse(file.buffer);
      const chunks = splitIntoChunks(data.text);

      for (let i = 0; i < chunks.length; i++) {
        allChunks.push({
          source: file.originalname,
          index: i,
          text: chunks[i]
        });
      }

      console.log(`Parsed: ${file.originalname} → ${chunks.length} chunks`);
    }

    fs.writeFileSync(CHUNKS_PATH, JSON.stringify(allChunks, null, 2));

    res.json({
      success: true,
      message: `Processed ${req.files.length} PDF(s) into ${allChunks.length} chunks`
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Error processing PDFs" });
  }
});

// ─── POST /upload ─────────────────────────────────────────────────────────────
// Accepts a screenshot, searches chunks for context, then asks Claude to answer
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const imageBase64 = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype;

    // Step 1: extract question text to search slides
    let contextText = "";

    if (fs.existsSync(CHUNKS_PATH)) {
      const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, "utf-8"));

      if (chunks.length > 0) {
        const extractRes = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 200,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: "Extract the question text and all answer options from this image. Return only the raw text, nothing else." }
            ]
          }]
        });

        const questionText = extractRes.content[0].text;
        console.log("Extracted:", questionText);
        console.log("Extract usage:", { input: extractRes.usage.input_tokens, output: extractRes.usage.output_tokens });

        const topChunks = searchChunks(questionText, chunks, 3);
        console.log(`Matched ${topChunks.length} chunks`);

        if (topChunks.length > 0) {
          contextText = topChunks.map(c => `[${c.source}]\n${c.text}`).join("\n\n---\n\n");
        }
      }
    }

    // Step 2: answer using slide context + math reasoning
    const prompt = contextText
      ? `You are an expert exam solver. Use the following material from the course slides as your reference:\n\n${contextText}\n\n---\n\nNow look at the question in the image. Based on the slides above:\n- If it requires calculation, apply the relevant formula\n- If it is conceptual, use the definitions from the slides\n- Evaluate all options and pick the correct one\n\nOutput format:\n<number>. <answer text>\n\nReturn ONLY the final answer. No explanation. No steps.`
      : `You are an expert exam solver. This question may require calculation or conceptual reasoning.\nSolve it carefully, evaluate all options, and pick the correct one.\n\nOutput format:\n<number>. <answer text>\n\nReturn ONLY the final answer. No explanation. No steps.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: prompt }
        ]
      }]
    });

    console.log("Answer usage:", { input: response.usage.input_tokens, output: response.usage.output_tokens });
    res.json({ answer: response.content[0].text });

  } catch (err) {
    console.error(err);
    res.json({ answer: "Error..." });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
