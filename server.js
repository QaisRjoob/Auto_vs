const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();

app.use(cors());

const upload = multer({
  storage: multer.memoryStorage()
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

app.post("/upload", upload.single("image"), async (req, res) => {

  try {

    const imageBase64 = req.file.buffer.toString("base64");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: req.file.mimetype,
                data: imageBase64
              }
            },
            {
              type: "text",
              text: `Analyze the image and give me the answer along with the answer number only.  You are solving a multiple-choice question.

Return ONLY the correct option number.

Examples:
1 the answer ...etc
2 the answer ...etc
3 the answer ...etc
4 the answer ...etc

No explanation.
No reasoning.
No extra text.
Only a single number.`
            }
          ]
        }
      ]
    });

    res.json({
      answer: response.content[0].text
    });

  } catch (err) {

    console.error(err);

    res.json({
      answer: "Error..."
    });
  }
});

app.listen(process.env.PORT || 3000);
