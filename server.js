const express = require("express");
const multer = require("multer");
const cors = require("cors");

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

// ===== AI endpoint (mock for now) =====
app.post("/upload", upload.single("image"), async (req, res) => {
    if (!req.file) {
        return res.json({ answer: "No image received" });
    }

    console.log("Image received:", req.file.size, "bytes");

    // Mock response — AI integration goes here next
    res.json({
        answer: "تم استلام الصورة، الربط مع AI جاهز بالخطوة التالية 🔥"
    });
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
