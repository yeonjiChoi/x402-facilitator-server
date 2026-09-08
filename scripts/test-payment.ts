// Facilitator의 /v1/verify, /v1/settle을 실제로 테스트하기 위한 스크립트.
// 결제자(payer) 지갑의 private key로 EIP-3009 transferWithAuthorization 서명을 만들고,
// 그 결과를 로컬에서 실행 중인 서버의 /v1/verify (그리고 --settle 옵션 시 /v1/settle)에 보낸다.
//
// 실행 예시:
//   tsx --env-file=.env scripts/test-payment.ts
//   tsx --env-file=.env scripts/test-payment.ts --settle
//
// 필요한 환경변수 (.env에 추가):
//   PAYER_PRIVATE_KEY  결제자 지갑 private key (테스트 USDC를 들고 있어야 함)
//   PAY_TO             수취인 주소 (아무 주소나 가능, 잔액 필요 없음)
//
// 서버(src/server.ts)가 먼저 다른 터미널에서 떠 있어야 한다 (tsx --env-file=.env watch src/server.ts).

import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { toHex, type Address, type Hex } from "viem";
import { chain, eip712Types } from "../src/config/chain.js";
import { SUPPORTED_ASSETS } from "../src/config/assets.js";
import { env } from "../src/config/env.js";

const PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY;
const PAY_TO = process.env.PAY_TO;

if (!PAYER_PRIVATE_KEY) {
  throw new Error(
    ".env에 PAYER_PRIVATE_KEY(결제자 지갑 private key)를 설정하세요.",
  );
}
if (!PAY_TO) {
  throw new Error(".env에 PAY_TO(수취인 주소)를 설정하세요.");
}

// --settle 같은 플래그를 금액으로 착각하지 않도록, "--"로 시작하지 않는 인자만 위치 인자로 취급.
const positionalArgs = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"));
// CLI 인자로 금액 오버라이드 가능. 기본값 30000 = USDC 6 decimals 기준 0.03 USDC.
const amount = positionalArgs[0] ?? "30000";
const shouldSettle = process.argv.includes("--settle");

const payerAccount = privateKeyToAccount(PAYER_PRIVATE_KEY as `0x${string}`);
const asset = SUPPORTED_ASSETS.USDC;

const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: payerAccount.address,
  to: PAY_TO,
  value: amount,
  validAfter: "0", // 즉시 유효
  validBefore: String(now + 300), // 5분 뒤 만료
  nonce: toHex(randomBytes(32)),
};

// config/chain.ts에 정의된 것과 동일한 domain/types를 사용해야 서버 쪽 검증(verifyTypedData)과 일치함.
const domain = {
  name: asset.eip712Name,
  version: asset.eip712Version,
  chainId: chain.id,
  verifyingContract: asset.address,
} as const;

const signature = await payerAccount.signTypedData({
  domain,
  types: eip712Types,
  primaryType: "TransferWithAuthorization",
  message: {
    from: authorization.from,
    to: authorization.to as Address,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce as Hex,
  },
});

const paymentRequirements = {
  scheme: "exact" as const,
  network: "base-sepolia",
  asset: asset.address,
  amount,
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
};

const paymentPayload = {
  x402Version: 1,
  accepted: paymentRequirements,
  payload: { signature, authorization },
};

const body = JSON.stringify({ paymentPayload, paymentRequirements });
const baseUrl = `http://localhost:${env.PORT}`;

console.log("--- 서명 완료 ---");
console.log("payer:", payerAccount.address);
console.log("payTo:", PAY_TO);
console.log("amount:", amount);
console.log();

// 포스트맨 등에서 수동 테스트할 때 그대로 복사해서 쓸 수 있도록 요청 바디를 출력.
console.log("--- 포스트맨용 body ---");
console.log(body);
console.log();

console.log(`POST ${baseUrl}/v1/verify`);
const verifyRes = await fetch(`${baseUrl}/v1/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
console.log(verifyRes.status, await verifyRes.json());

if (shouldSettle) {
  console.log();
  console.log(`POST ${baseUrl}/v1/settle`);
  const settleRes = await fetch(`${baseUrl}/v1/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  console.log(settleRes.status, await settleRes.json());
}
