(() => {

    const UPLOAD_URL = "https://auto-vs.onrender.com/upload";

    let ballVisible = true;

    // ── الكرة الحمراء ──
    const ball = document.createElement("div");
    ball.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: red;
        z-index: 999999;
        cursor: pointer;
        box-shadow: 0 0 10px rgba(0,0,0,.3);
    `;
    document.body.appendChild(ball);

    // ── صندوق الجواب ──
    const answerBox = document.createElement("div");
    answerBox.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        background: white;
        border: 1px solid #ddd;
        padding: 14px 16px;
        max-width: 350px;
        max-height: 300px;
        overflow: auto;
        border-radius: 10px;
        box-shadow: 0 0 15px rgba(0,0,0,.2);
        z-index: 999999;
        font-size: 16px;
        font-weight: bold;
        display: none;
        direction: rtl;
    `;
    answerBox.innerText = "الصق صورة السؤال (Ctrl+V)";
    document.body.appendChild(answerBox);

    // ── كليك على الكرة: يفتح/يغلق الصندوق ──
    ball.addEventListener("click", () => {
        const isVisible = answerBox.style.display === "block";
        answerBox.style.display = isVisible ? "none" : "block";
    });

    // ── H: يخفي/يظهر الكرة والصندوق ──
    window.addEventListener("keydown", (e) => {
        if (e.key.toLowerCase() === "h") {
            ballVisible = !ballVisible;
            ball.style.display = ballVisible ? "block" : "none";
            answerBox.style.display = "none";
        }
    });

    // ── لصق صورة: يرسل للسيرفر ويظهر الجواب تلقائياً ──
    document.addEventListener("paste", async (e) => {
        const imageItem = [...e.clipboardData.items]
            .find(item => item.type.startsWith("image/"));

        if (!imageItem) return;

        const file = imageItem.getAsFile();

        // أظهر الصندوق تلقائياً مع رسالة انتظار
        answerBox.style.display = "block";
        answerBox.innerText = "⏳ جاري التفكير...";
        ball.style.background = "orange";

        const fd = new FormData();
        fd.append("image", file);

        try {
            const res = await fetch(UPLOAD_URL, {
                method: "POST",
                body: fd
            });

            const data = await res.json();

            answerBox.innerText = data.answer || "لم يرد جواب";
            ball.style.background = "green";

        } catch (err) {
            answerBox.innerText = "فشل الاتصال بالسيرفر";
            ball.style.background = "red";
        }
    });

})();
