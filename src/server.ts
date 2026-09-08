import app from "./app.js";
import { env } from "./config/env.js";

// 실제로 포트를 열고 서버를 띄우는 부분
app.listen(env.PORT, () => {
  console.log(`listening on ${env.PORT}`);
});
