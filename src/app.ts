import express from "express";
import route from "./routes/route.js";

const app = express();

// JSON 바디 파싱 미들웨어. 라우트보다 먼저 등록해야 req.body가 채워짐
app.use(express.json());
app.use(route);

export default app;
