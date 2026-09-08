# CLAUDE.md — Facilitator 서버 프로젝트 컨텍스트

> 이 파일은 Claude Code가 이 프로젝트를 작업할 때 참고할 컨텍스트 문서입니다.
> 마지막 갱신 기준 상태: `/health`, `POST /v1/verify`, `POST /v1/settle`, `GET /supported` 전부 구현 완료. x402 핵심 3종 엔드포인트 완료 상태.
> 라우트는 파일별 분리 대신 `routes/route.ts` 단일 파일에 전부 등록하는 방식으로 결정함.
> 타입/zod 스키마는 별도 패키지 `x402-facilitator-sdk`로 분리됨 (1번 섹션 참고) — `src/types/payment.ts`는 재노출 shim일 뿐.

---

## 1. 프로젝트가 뭔지

**x402 프로토콜 기반 Facilitator 서버**를 만들고 있습니다. Facilitator는 AI 에이전트/구매자가 만든 스테이블코인 결제 서명을 검증하고, 유효하면 온체인에 실제 결제를 실행하는 독립 서버입니다. 리소스 서버(쇼핑몰)는 이 Facilitator를 SDK로 호출만 하지, 직접 구현하지 않습니다.

```
구매자(에이전트) → 리소스 서버(쇼핑몰) → Facilitator 서버 → 블록체인(Base Sepolia)
```

프로젝트 범위는 **Facilitator 서버만**입니다. 리소스 서버, SDK, 대시보드는 별도 프로젝트(이 저장소 범위 밖).

**SDK(`x402-facilitator-sdk`)**: `cop/x402-facilitator-sdk`에 별도 npm 패키지로 실제 존재함 (2026-09-07 추가). x402 결제 프로토콜의 zod 스키마/타입(`PaymentRequirements`, `PaymentPayload`, `VerifyResult`, `SettleResult`, `SupportedResponse` 등)과 `createFacilitatorClient({ baseUrl })` HTTP 클라이언트를 담고 있음. 이 저장소(`x402-facilitator-server`)와 `cop/resource-server` 둘 다 이 패키지를 `file:../x402-facilitator-sdk`로 설치해서 씀 — **`src/types/payment.ts`는 더 이상 자체 스키마를 정의하지 않고 `export * from "x402-facilitator-sdk";`만 함**. 스키마를 바꿀 땐 `x402-facilitator-sdk/src/schemas.ts`를 고치고 `npm run build`(해당 SDK 폴더에서) 한 뒤, 이 저장소와 `resource-server`에서 각각 `npm install`로 다시 받아야 반영됨 (`file:` 의존성은 소스가 아니라 `dist`를 봄).

---

## 2. 기술 스택 및 핵심 결정 사항

| 항목 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js 24 | Active LTS |
| 프레임워크 | **Express** (Fastify 아님) | 세팅 단순함 우선 — Fastify는 시도했으나 초기 세팅 마찰이 커서 Express로 전환함 |
| 언어 | TypeScript (ESM) | — |
| 실행 도구 | `tsx watch` (개발), `tsc` (빌드) | — |
| 검증 | `zod` (v4 — `z.record(keyType, valueType)` 2-argument 시그니처 사용) | 요청 스키마 검증 |
| 체인 통신 | `viem` | EIP-712/EIP-3009 검증 지원 우수 |
| 체인 | Base Sepolia (테스트넷) | `viem/chains`의 `baseSepolia`를 코드에 고정 사용. 다른 체인 지원 계획이 없어 `.env`로 뺄 필요 없다고 판단 — `CHAIN_ID`/`CHAIN_NAME`/`CHAIN_RPC_URL` env 제거함 |
| **DB** | **의도적으로 사용 안 함** | 아래 3번 섹션 참고 |

### 왜 DB가 없는지 (중요한 설계 결정)

- 잔액 조회, 거래 상태 조회, 거래 내역은 전부 체인(RPC)에서 직접 조회 가능
- nonce 재사용 방지는 USDC/KRWH가 쓰는 **EIP-3009 표준 자체가 컨트랙트 안에서 처리** (`authorizationState` 비트맵) — 별도 DB 기반 체크가 소스 오브 트루스가 아님
- `/settle`은 브로드캐스트까지만 동기로 기다렸다가 `txHash`를 바로 응답하도록 설계할 예정 → `transactionId = txHash`로 통일 가능 → pending 상태를 추적할 DB도 불필요
- 이후 감사 로그나 분석이 필요해지면 그때 Postgres를 추가하는 것으로 결정 (지금은 아님)

---

## 3. 폴더 구조

```
src/
├── server.ts              # 실행 진입점 — listen()만 담당
├── app.ts                 # express 인스턴스 조립 (미들웨어 + 라우트 등록)
├── config/                # 외부 연결/설정 (체인, 자산 레지스트리, 환경변수)
│   ├── env.ts              # zod로 process.env 검증
│   ├── chain.ts             # viem publicClient, EIP-3009 ABI, EIP-712 types
│   └── assets.ts             # USDC/KRWH 등 지원 자산 레지스트리 (주소, decimals, EIP-712 도메인)
├── types/
│   └── payment.ts            # x402-facilitator-sdk 재노출 shim (export * from "x402-facilitator-sdk"). 실제 스키마는 그 패키지에 있음
├── services/
│   └── verification.service.ts  # 순수 로직 — express도 req/res도 모름
└── routes/
    └── route.ts              # 모든 라우트(health, verify, settle 등)를 한 파일에 등록. 엔드포인트 수가 적어 파일별 분리 대신 단일 파일로 결정
```

**레이어 규칙 (반드시 지킬 것)**
- `routes/`는 HTTP 형태(스키마 검증, 상태 코드)만 담당. 비즈니스 로직을 라우트 핸들러 안에 직접 쓰지 않음
- `services/`는 순수 함수. express, req, res를 import하지 않음 (나중에 CLI나 다른 프레임워크에서도 재사용 가능하도록)
- `config/`는 외부 연결(체인, 자산 설정)만. 비즈니스 로직 없음

---

## 4. 지금 당장 필요한 API (우선순위순)

### ✅ 구현 완료 (x402 핵심 3종 전부)

| 엔드포인트 | 역할 |
|---|---|
| `GET /health` | 서버 생존 확인. DB 없으므로 별도 헬스체크 로직 없이 단순 응답 |
| `POST /v1/verify` | 결제 서명 검증만 수행 (온체인 실행 없음). `paymentPayload` + `paymentRequirements`를 받아 서로 대조하고, EIP-712 서명·유효시간·nonce·잔액을 확인. `docs/api.md` 참고 |
| `POST /v1/settle` | 검증된 결제를 실제로 온체인에 제출. `verifyPayment()` 재실행 후 `walletClient.writeContract()`로 `transferWithAuthorization` 브로드캐스트, 컨펌 대기 없이 `txHash` 바로 응답. `src/services/settlement.service.ts`. `docs/api.md` 참고 |
| `GET /v1/supported` | 지원 scheme/network/asset 목록 + EIP-712 도메인 정보(`extra`) + Facilitator 서명 지갑 주소(`signers`). 자산 하나당 `kind` 하나로 분리 (CDP 공식 예시와 달리 한 network에 자산이 여럿이라). `docs/api.md` 참고. (예전엔 `/supported`로 버전 prefix 없이 노출됐으나, `/v1/verify`·`/v1/settle`과 통일하기 위해 `/v1/supported`로 변경함 — `/health`만 인프라성 엔드포인트라 버전 prefix 없이 유지) |

### 🟡 나중에 필요

| 엔드포인트 | 비고 |
|---|---|
| `GET /v1/wallets/:address/balance` | DB 없이 체인에서 직접 `balanceOf` 조회, 구현 단순함 |
| `GET /v1/wallets/:address/history` | USDC/KRWH `Transfer` 이벤트 로그를 `getLogs`로 조회 |
| `GET /v1/transactions/:txHash` | `getTransactionReceipt`로 상태 조회. `settle`에서 `transactionId = txHash`로 설계하면 이 엔드포인트는 거의 그대로 체인 프록시가 됨 |

### ⚪ 우선순위 낮음 / 보류

- Rate limiting, API Key 인증 (`Authorization: Bearer`) — 지금은 인증 없이 열려있음. 프로토타입 단계에서는 생략, 실제 배포 전에 추가 필요
- Webhook (`/v1/webhooks/subscribe`) — 리소스 서버가 폴링으로 충분하면 불필요
- DB, 감사 로그 — 3번 섹션 참고, 의도적으로 안 함

---

## 5. 데이터 타입 (x402 v2 스펙 정합)

`src/types/payment.ts`에 정의됨. 핵심 구조:

```
PaymentRequirements  — scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra
PaymentPayload        — x402Version, resource?, accepted(=PaymentRequirements), payload, extensions?
  payload (exact EVM)  — signature, authorization{ from, to, value, validAfter, validBefore, nonce }
```

**중요한 보안 규칙**: `PaymentRequirements.extra`(EIP-712 domain name/version 등)는 클라이언트가 조작 가능하므로 **절대 신뢰하지 않음**. 서명 검증 시엔 `asset` 주소로 `config/assets.ts`의 자체 레지스트리를 조회해서 얻은 값만 사용.

---

## 6. 자산(Asset) 확장 방식

현재 USDC(테스트넷) 지원. **KRWH(자체 배포 예정 토큰)도 추가할 계획**.

- `config/assets.ts`의 `SUPPORTED_ASSETS`에 항목 추가하는 방식으로 확장
- 새 자산 추가 시 반드시 필요한 조건: **EIP-3009(`transferWithAuthorization`, `authorizationState`)를 토큰 컨트랙트가 구현**해야 지금 검증 로직을 그대로 재사용 가능
- 자산별 필요 정보: `address`, `decimals`(가능하면 컨트랙트의 `decimals()`를 직접 조회하도록 개선 예정, 현재는 `.env` 하드코딩), `eip712Name`, `eip712Version` — 전부 `.env`로 관리 중

---

## 7. 환경변수 (`.env`)

```
PORT=3000
NODE_ENV=development

USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
USDC_DECIMALS=6
USDC_EIP712_NAME=USDC
USDC_EIP712_VERSION=2

KRWH_ADDRESS=0x0000000000000000000000000000000000000000  # 배포 후 교체
KRWH_DECIMALS=18
KRWH_EIP712_NAME=KRWH
KRWH_EIP712_VERSION=1

# /settle에서 walletClient 서명/브로드캐스트에 사용 중
FACILITATOR_PRIVATE_KEY=0xREPLACE_ME
```

---

## 8. 알려진 이슈 / 주의사항

- **zod v4**: `z.record()`는 이제 `z.record(keyType, valueType)` 2개 인자 필수. `z.record(z.unknown())`처럼 1개만 주면 타입 에러남
- **tsconfig**: `esModuleInterop: true` 안 켜져 있으면 일부 import에서 에러 날 수 있음
- **EIP-712 domain 값**: `eip712Name`/`eip712Version`이 실제 토큰 컨트랙트 배포 시 지정한 값과 **한 글자라도 다르면 서명 검증이 전부 실패**함. KRWH 배포 시 반드시 컨트랙트 생성자 코드에서 실제 지정한 값을 확인해서 `.env`에 정확히 맞출 것
- **가스비**: 결제는 USDC/KRWH로 오가지만, Facilitator가 트랜잭션을 브로드캐스트할 때 가스비는 항상 네이티브 토큰(Base는 ETH)으로 냄 — Facilitator 운영 지갑에 ETH 잔액이 없으면 `/settle`이 실패함. Base Sepolia ETH는 Coinbase CDP faucet(`portal.cdp.coinbase.com/products/faucet`)에서 받을 수 있음
- **인증 없음**: 현재 모든 엔드포인트가 인증 없이 열려있음. 프로토타입/데모 단계라 의도적으로 생략 중

---

## 9. 다음 작업 순서 제안

x402 핵심 3종(`verify`/`settle`/`supported`)과 SDK 분리까지 완료됨. 다음 후보:

1. `/v1/wallets/:address/balance` — 체인 직접 조회, 가장 구현 쉬움
2. `/v1/transactions/:txHash` — `getTransactionReceipt` 래핑
3. `/v1/wallets/:address/history` — 이벤트 로그 조회 (`getLogs`)
4. (실사용 계획이 생기면) Rate limiting / API Key 인증, `verifyPayment`/`settlePayment` 유닛 테스트 — 8번 섹션 "우선순위 낮음" 참고, 실제 배포 전엔 필수
