import express from "express";
import route from "./routes/route.js";

// 서버를 "조립"만 하는 함수. listen()은 여기서 하지 않음
// → 나중에 테스트 코드에서 실제 포트를 열지 않고 이 app을 가져다 쓸 수 있게 하기 위함
const app = express();

// JSON 바디 파싱 미들웨어. 라우트보다 먼저 등록해야 req.body가 채워짐
app.use(express.json());

app.use(route);

export default app;
