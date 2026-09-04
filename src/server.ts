import app from "./app.js";
import { env } from "./config/env.js";

// 실제로 포트를 열고 서버를 띄우는 부분. app.ts와 분리해둔 덕분에 이 파일만 얇게 유지됨
app.listen(env.PORT, () => {
  console.log(`listening on ${env.PORT}`);
});
