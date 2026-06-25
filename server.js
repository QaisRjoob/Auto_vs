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

    let contextText = "";

    // Use RAG only if chunks.json exists and has data
    if (fs.existsSync(CHUNKS_PATH)) {
      const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, "utf-8"));

      if (chunks.length > 0) {
        // Step 1: Extract the question text from the screenshot
        const extractRes = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 }
              },
              {
                type: "text",
                text: "Extract the question text from this image. Return only the raw question text, nothing else."
              }
            ]
          }]
        });

        const questionText = extractRes.content[0].text;
        console.log("Extracted question:", questionText);

        // Step 2: Find best matching chunks
        const topChunks = searchChunks(questionText, chunks, 5);
        console.log(`Found ${topChunks.length} relevant chunks`);

        if (topChunks.length > 0) {
          contextText = topChunks
            .map(c => `[${c.source}]\n${c.text}`)
            .join("\n\n---\n\n");
        }
      }
    }

    // Step 3: Ask Claude to answer using the context (or directly if no context)
    const prompt = contextText
      ? `You are solving a multiple-choice question. Use the following material from the course as reference:\n\n${contextText}\n\n---\n\nNow look at the image and answer the multiple-choice question.\n\nOutput format:\n<number>. <answer text>\n\nReturn only the final answer. No explanation. No reasoning.`
      : `Analyze the image and give me the answer along with the answer number only. You are solving a multiple-choice question from an image.\n\nOutput format:\n<number>. <answer text>\n\nExample:\n3. Mitigate Moral Hazard\n\nReturn only the final answer.\nDo not explain your reasoning.\nDo not analyze the question.\nDo not write complete sentences.\nDo not include any text besides the answer.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 }
          },
          { type: "text", text: prompt }
        ]
      }]
    });

    res.json({ answer: response.content[0].text });

  } catch (err) {
    console.error(err);
    res.json({ answer: "Error..." });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
