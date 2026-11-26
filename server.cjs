const express = require("express");
const app = express();
const PORT = 3001;

app.use(express.json());

app.get("/api/health", (req, res) => {
res.json({
status: "ok",
message: "الخادم يعمل"
});
});

app.post("/api/requests", (req, res) => {
const description = req.body?.description;

if (
typeof description !== "string" ||
!description.trim()
) {
return res.status(400).json({
error: "يرجى إدخال وصف الطلب"
});
}

res.status(200).json({
success: true,
message: "تم استقبال الطلب بنجاح",
receivedText: description.trim()
});
});

app.listen(PORT, () => {
console.log(
"Backend: http://localhost:" + PORT
);
});