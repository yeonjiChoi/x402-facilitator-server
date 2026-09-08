# x402-facilitator-server

x402 프로토콜의 **Facilitator** 역할을 하는 독립 서버. 구매자(에이전트/지갑)가 만든 EIP-3009(`transferWithAuthorization`) 결제 서명을 검증하고, 유효하면 실제로 온체인(Base Sepolia)에 정산을 실행한다.

```
구매자(에이전트) → 리소스 서버(쇼핑몰) → Facilitator 서버(이 저장소) → 블록체인(Base Sepolia)
```

리소스 서버는 결제 검증/정산 로직을 직접 구현하지 않고, 이 서버를 `x402-facilitator-sdk`로 호출만 한다. 리소스 서버·SDK는 별도 저장소(`cop/resource-server`, `cop/x402-facilitator-sdk`)이며 이 저장소 범위 밖이다.

## 구조

```
src/
├── server.ts                       # 실행 진입점 — listen()만 담당
├── app.ts                          # express 인스턴스 조립 (미들웨어 + 라우트 등록)
├── config/
│   ├── env.ts                      # zod로 process.env 검증
│   ├── chain.ts                    # viem publicClient/walletClient, EIP-3009 ABI, EIP-712 types
│   └── assets.ts                   # USDC/KRWH 등 지원 자산 레지스트리
├── types/
│   └── payment.ts                  # x402-facilitator-sdk 재노출 shim (스키마 실체는 SDK 패키지에 있음)
├── services/
│   ├── verification.service.ts     # 순수 함수 — 서명/유효시간/nonce/잔액 검증 (verifyPayment)
│   └── settlement.service.ts       # 재검증 + 온체인 transferWithAuthorization 실행 (settlePayment)
└── routes/
    └── route.ts                    # 모든 라우트(health, verify, settle, supported)를 한 파일에 등록
```

**레이어 규칙**: `routes/`는 HTTP 형태(스키마 검증, 상태 코드)만 담당, `services/`는 express/req/res를 모르는 순수 함수, `config/`는 외부 연결(체인·자산)만 담당한다.

### API

| 엔드포인트 | 역할 |
|---|---|
| `GET /health` | 서버 생존 확인 |
| `POST /v1/verify` | 결제 서명 검증만 수행 (온체인 실행 없음) |
| `POST /v1/settle` | 검증 후 실제로 온체인에 `transferWithAuthorization` 브로드캐스트, 컨펌 대기 없이 `txHash` 응답 |
| `GET /v1/supported` | 지원 scheme/network/asset 목록 + EIP-712 도메인 정보 + Facilitator 서명 지갑 주소 |

현재 인증 없이 전부 열려있다 (프로토타입 단계, 실제 배포 전 추가 필요). DB는 의도적으로 쓰지 않는다 — 잔액/거래 상태는 체인에서 직접 조회하고, nonce 재사용 방지는 EIP-3009 표준이 컨트랙트 안에서(`authorizationState`) 처리한다.

## 실행 방법

### 1. 의존성 설치

`x402-facilitator-sdk`는 GitHub Packages(`@yeonjichoi/x402-facilitator-sdk`)에서 받아온다. `npm install`이 이 레지스트리에 접근하려면 GitHub Personal Access Token(`read:packages` 스코프)이 필요하다.

```bash
# GitHub에서 발급받은 토큰을 환경변수로 설정 (파일에 직접 넣지 말 것)
export GITHUB_TOKEN="발급받은_토큰"

npm install
```

`.npmrc`에 이미 `@yeonjichoi:registry=https://npm.pkg.github.com`와 `_authToken=${GITHUB_TOKEN}` 설정이 들어있다 — `GITHUB_TOKEN` 환경변수만 채워주면 된다.

### 2. `.env` 설정

`.env.example`을 복사해서 `.env`를 만들고 값을 채운다.

```bash
cp .env.example .env
```

| 변수 | 설명 |
|---|---|
| `PORT` | 리슨 포트 (기본 3000) |
| `NODE_ENV` | `development` / `test` / `production` |
| `USDC_ADDRESS` | USDC 토큰 컨트랙트 주소 (Base Sepolia) |
| `USDC_DECIMALS` | USDC decimals (6) |
| `USDC_EIP712_NAME` / `USDC_EIP712_VERSION` | USDC의 EIP-712 domain name/version — 실제 배포 컨트랙트 값과 한 글자라도 다르면 서명 검증이 전부 실패함 |
| `KRWH_ADDRESS` / `KRWH_DECIMALS` / `KRWH_EIP712_NAME` / `KRWH_EIP712_VERSION` | KRWH(자체 배포 예정 토큰)용 값. 배포 전엔 더미 주소로 둬도 서버는 뜬다 |
| `FACILITATOR_PRIVATE_KEY` | Facilitator 운영 지갑 private key. `/v1/settle`이 이 지갑으로 서명·브로드캐스트한다. **Base Sepolia ETH(가스비)를 들고 있어야 함** |

`scripts/test-payment.ts`(테스트 스크립트) 전용으로 아래 두 변수도 `.env`에 추가로 필요하다 (서버 자체 구동엔 불필요):

| 변수 | 설명 |
|---|---|
| `PAYER_PRIVATE_KEY` | 결제자(구매자) 지갑 private key — 테스트넷 USDC를 들고 있어야 함 (EIP-3009는 가스리스라 ETH는 불필요) |
| `PAY_TO` | 수취인 주소 — 아무 주소나 가능, 잔액 필요 없음 |

### 3. 서버 실행

```bash
npm run dev
```

`tsx watch --env-file=.env src/server.ts`를 실행한다. 파일 변경 시 자동 재시작되고, `.env`는 `--env-file` 플래그로 명시적으로 로드된다 (dotenv 미사용).

## 테스트 방법

체계적인 유닛 테스트는 아직 없고(배포 전 추가 예정), 실제 서명을 만들어 서버에 쏴보는 통합 테스트 스크립트가 있다.

```bash
# 서버가 다른 터미널에서 떠 있어야 함 (npm run dev)

# /v1/verify만 테스트
npm run test:payment

# /v1/verify 통과 후 /v1/settle까지 실행 (실제 온체인 트랜잭션 발생)
npm run test:payment -- --settle

# 금액을 직접 지정 (기본값은 USDC 6 decimals 기준 최소 단위)
npm run test:payment -- 30000
```

`PAYER_PRIVATE_KEY` 지갑으로 EIP-712 서명을 직접 만들어 `/v1/verify`(그리고 `--settle` 옵션 시 `/v1/settle`)에 전송하고 응답을 콘솔에 출력한다. Postman 등에서 수동으로 테스트하고 싶다면 스크립트 실행 시 콘솔에 찍히는 `--- 포스트맨용 body ---` 아래 JSON을 그대로 복사해서 쓰면 된다.

**주의**: `--settle`로 한 번 성공한 요청은 같은 서명(nonce)으로 재사용할 수 없다 — EIP-3009 컨트랙트가 온체인에 소진 여부(`authorizationState`)를 기록하기 때문에, 재시도하려면 스크립트를 다시 실행해 새 nonce로 서명해야 한다.

## 빌드 / 타입체크

```bash
npx tsc --noEmit
```
