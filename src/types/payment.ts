import z from "zod";

// ─────────────────────────────────────────────────────────────
// x402 결제 프로토콜의 데이터 형태 정의.
//
// 전체 흐름:
// 1. 클라이언트가 유료 API를 호출 → 서버가 402 응답과 함께 PaymentRequirements(결제 조건)를 알려줌
// 2. 클라이언트는 그 조건에 맞춰 EIP-3009(transferWithAuthorization)를 지갑으로 서명
// 3. 클라이언트가 서명 결과를 PaymentPayload에 담아 X-PAYMENT 헤더로 재요청
// 4. 서버(이 facilitator)는 그 서명이 조건과 일치하고 유효한지 검증 → VerifyResult 반환
// ─────────────────────────────────────────────────────────────

// 결제 대상 리소스(=유료 API/컨텐츠)를 사람이 알아볼 수 있게 설명하는 정보. 검증 로직과는 무관, 표시용.
export const ResourceInfoSchema = z.object({
  url: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  serviceName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  iconUrl: z.string().optional(),
});

// 서버가 "이 결제 조건이어야만 받아주겠다"고 요구하는 스펙. 402 응답에 실려서 클라이언트에게 전달됨.
export const PaymentRequirementsSchema = z.object({
  scheme: z.literal("exact"), // 결제 방식. 지금은 "정확히 이 금액만" 받는 exact 방식만 지원
  network: z.string(), // 어느 체인에서 결제할지 (예: base-sepolia)
  asset: z.string(), // 어떤 토큰으로 낼지 - 토큰 컨트랙트 주소 (USDC, KRWH 등)
  amount: z.string(), // 결제해야 할 금액. 숫자(number)가 아니라 문자열인 이유: number는 소수점 계산 시 오차가 생겨서 큰 금액을 다룰 때 위험함
  payTo: z.string(), // 돈을 받을 주소
  maxTimeoutSeconds: z.number(), // 이 시간 안에 결제를 완료해야 함
  // EIP-712 서명에 필요한 도메인 이름/버전 같은 부가정보가 여기 담겨 오지만,
  // 이 값은 클라이언트가 마음대로 조작해서 보낼 수 있는 "자기 신고" 값이라 신뢰할 수 없음.
  // 그래서 실제 서명 검증 시에는 이 값을 쓰지 않고, asset 주소로 서버가 직접 관리하는
  // 자산 목록(assets.ts의 SUPPORTED_ASSETS)에서 조회한 값만 사용한다.
  extra: z.record(z.string(), z.unknown()).optional(),
});

// EIP-3009 transferWithAuthorization 표준에서 지갑이 실제로 서명하는 필드들.
// (일반 트랜잭션 없이도 "이 조건이면 이체를 허락한다"는 서명만으로 결제를 처리할 수 있게 해주는 표준)
export const AuthorizationSchema = z.object({
  from: z.string(), // 돈을 보내는 사람 (서명한 지갑 주소)
  to: z.string(), // 돈을 받는 사람
  value: z.string(), // 이체할 금액
  validAfter: z.string(), // 이 시각이 지나야 이 서명이 유효해짐 (보통 0 = 즉시 유효)
  validBefore: z.string(), // 이 시각이 지나면 서명이 만료됨
  nonce: z.string(), // 이 서명 한 번만 쓰기 위한 랜덤값. 컨트랙트가 "이미 쓴 nonce인지" 온체인에 기록해서 같은 서명 재사용(재생 공격)을 막음
});

// "exact + EVM 체인" 조합일 때의 결제 증거 형태: 서명값 + 그 서명이 만들어진 원본 데이터(authorization)
export const ExactEvmPayloadSchema = z.object({
  signature: z.string(), // authorization 내용에 대해 지갑이 서명한 결과값
  authorization: AuthorizationSchema, // 서명 대상이 된 원본 데이터. 이게 있어야 서버가 서명을 검증할 수 있음
});

// 클라이언트가 재요청 시 X-PAYMENT 헤더에 담아 보내는, "나 이렇게 결제했어요"를 증명하는 전체 데이터.
export const PaymentPayloadSchema = z.object({
  x402Version: z.number(), // 프로토콜 버전 (하위 호환성 관리용)
  resource: ResourceInfoSchema.optional(), // 어떤 리소스에 대한 결제인지 (표시용)
  accepted: PaymentRequirementsSchema, // 클라이언트가 "이 조건에 동의하고 서명했다"고 주장하는 조건 (그대로 믿지 않고 서버가 실제 조건과 대조함)
  payload: ExactEvmPayloadSchema, // 실제 서명 증거
  extensions: z.record(z.string(), z.unknown()).optional(), // 프로토콜 확장을 위한 여유 필드
});

// /v1/verify 요청 바디 전체.
export const VerifyRequestSchema = z.object({
  paymentPayload: PaymentPayloadSchema,
  paymentRequirements: PaymentRequirementsSchema,
});

export const SettleRequestSchema = VerifyRequestSchema;

// 위 zod 스키마들로부터 TypeScript 타입을 자동 생성 (스키마와 타입이 따로 놀 일이 없게)
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;
export type Authorization = z.infer<typeof AuthorizationSchema>;
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

// 서명/결제 검증 로직의 최종 결과 타입.
// 실패한 경우에도 payer(누가 시도했는지)는 최대한 채워서 반환 - 실패 로그 남길 때 "누가" 정보가 필요해서.
export type VerifyResult =
  | { isValid: true; payer: string }
  | { isValid: false; invalidReason: string; payer?: string };

// x402 v2 스펙(Section 5.3.2, SettleResponse)의 settle 응답 형식.
// transaction/network는 실패 케이스에서도 필수 - 실패 시 transaction은 빈 문자열("")로 채워서 응답한다.
export type SettleResult =
  | { success: true; transaction: string; network: string; payer: string }
  | {
      success: false;
      errorReason: string;
      transaction: string;
      network: string;
      payer?: string;
    };
