const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");

const PDFS_FOLDER = process.argv[2];
const CHUNKS_PATH = path.join(__dirname, "data", "chunks.json");

if (!PDFS_FOLDER) {
  console.error("Usage: node seed.js <path-to-pdfs-folder>");
  process.exit(1);
}

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

async function run() {
  const files = fs.readdirSync(PDFS_FOLDER).filter(f => f.endsWith(".pdf"));
  console.log(`Found ${files.length} PDF(s)\n`);

  const allChunks = [];

  for (const file of files) {
    const filePath = path.join(PDFS_FOLDER, file);
    const buffer = fs.readFileSync(filePath);

    try {
      const data = await pdfParse(buffer);
      const chunks = splitIntoChunks(data.text);

      for (let i = 0; i < chunks.length; i++) {
        allChunks.push({ source: file, index: i, text: chunks[i] });
      }

      console.log(`✓ ${file} → ${chunks.length} chunks`);
    } catch (err) {
      console.error(`✗ ${file} → Error: ${err.message}`);
    }
  }

  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  fs.writeFileSync(CHUNKS_PATH, JSON.stringify(allChunks, null, 2));

  console.log(`\nDone! ${allChunks.length} total chunks saved to data/chunks.json`);
}

run();
