// zod 스키마/타입은 여기서 더 이상 직접 정의하지 않고 x402-facilitator-sdk 패키지 걸 그대로 가져다 쓴다.
// resource-server도 같은 패키지를 쓰기 때문에, 스키마를 고칠 땐 이 파일이 아니라
// x402-facilitator-sdk/src/schemas.ts를 고치고 양쪽에서 다시 설치해야 반영된다.
export * from "x402-facilitator-sdk";
