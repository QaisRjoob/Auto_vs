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

// Split text into overlapping chunks (~200 words each, 30-word overlap)
function splitIntoChunks(text, chunkSize = 200, overlap = 30) {
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

    const prompt = `You are an expert in mathematics, finance, and economics. You are solving a multiple-choice exam question.

After thinking, respond with ONE LINE ONLY.

Output format: <number>. <answer text>
Example: 3. 42.5%

YOUR ENTIRE RESPONSE MUST BE A SINGLE LINE. No explanation. No steps. Just the answer line.`;

    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: prompt }
        ]
      }]
    });

    const textBlock = response.content.find(b => b.type === "text");
    const raw = (textBlock ? textBlock.text : "").trim();
    const match = raw.match(/\d+\.\s+.+/);
    const answer = match ? match[0].trim() : raw.split("\n")[0].trim();

    console.log("Answer usage:", { input: response.usage.input_tokens, output: response.usage.output_tokens });
    res.json({ answer });

  } catch (err) {
    console.error(err);
    res.json({ answer: "Error..." });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
