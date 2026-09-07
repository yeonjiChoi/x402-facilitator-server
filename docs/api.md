# API 문서

Facilitator 서버가 제공하는 API 엔드포인트 문서. 엔드포인트가 추가될 때마다 이 파일에 섹션으로 이어서 정리한다.

## POST /v1/verify

결제 서명이 유효한지 **검증만** 하는 엔드포인트. 온체인에 아무것도 쓰지 않는다 (읽기 전용 조회만 수행).

리소스 서버가 클라이언트로부터 받은 `X-PAYMENT` 헤더(=`paymentPayload`)와, 자신이 애초에 402 응답에 실어 보냈던 결제 조건(`paymentRequirements`)을 이 엔드포인트에 같이 보내면, Facilitator가 둘을 대조하고 서명을 검증해서 결과를 알려준다.

### 요청

```
POST /v1/verify
Content-Type: application/json
```

```json
{
  "paymentPayload": {
    "x402Version": 1,
    "resource": {
      "url": "https://example.com/paid-resource",
      "description": "string (optional)",
      "mimeType": "string (optional)",
      "serviceName": "string (optional)",
      "tags": ["string", "..."],
      "iconUrl": "string (optional)"
    },
    "accepted": {
      "scheme": "exact",
      "network": "base-sepolia",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "amount": "1000000",
      "payTo": "0x...",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" }
    },
    "payload": {
      "signature": "0x...",
      "authorization": {
        "from": "0x...",
        "to": "0x...",
        "value": "1000000",
        "validAfter": "0",
        "validBefore": "1750000000",
        "nonce": "0x..."
      }
    },
    "extensions": {}
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "base-sepolia",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "amount": "1000000",
    "payTo": "0x...",
    "maxTimeoutSeconds": 60
  }
}
```

#### 필드 설명

| 필드 | 타입 | 설명 |
|---|---|---|
| `paymentPayload` | object | 클라이언트가 `X-PAYMENT` 헤더에 담아 보낸 결제 증거 전체. 리소스 서버가 그대로 전달 |
| `paymentPayload.accepted` | object | 클라이언트가 "이 조건에 동의하고 서명했다"고 주장하는 조건 (그대로 신뢰하지 않고 아래 `paymentRequirements`와 대조함) |
| `paymentPayload.payload.signature` | string | `authorization`에 대해 지갑이 서명한 EIP-712 서명값 |
| `paymentPayload.payload.authorization` | object | EIP-3009 `transferWithAuthorization`의 서명 대상 필드 (`from`/`to`/`value`/`validAfter`/`validBefore`/`nonce`) |
| `paymentRequirements` | object | 리소스 서버가 **실제로** 요구하는 결제 조건. 애초에 402 응답으로 클라이언트에게 내려줬던 것과 동일한 값을 그대로 다시 보내야 함 |

`amount`/`value`는 소수점 오차 방지를 위해 문자열로 취급한다 (최소 단위, 예: USDC는 6 decimals 기준 `1000000` = 1 USDC).

### 응답

#### 200 — 검증 성공

```json
{
  "isValid": true,
  "payer": "0x..."
}
```

#### 400 — 검증 실패

```json
{
  "isValid": false,
  "invalidReason": "invalid_exact_evm_payload_signature",
  "payer": "0x..."
}
```

`payer`는 실패 시에도 가능하면 채워서 반환한다 (실패 로그에 "누가" 시도했는지 남기기 위함). 요청 자체가 스키마와 안 맞으면 `payer` 없이 반환될 수 있다.

### 검증 순서 (하나라도 실패하면 즉시 그 이유로 응답)

`src/services/verification.service.ts`의 `verifyPayment()` 기준.

1. **요청 스키마 검증** — `paymentPayload`/`paymentRequirements` 형식이 안 맞으면 검증 로직을 타기 전에 바로 400
2. **조건 일치 확인** — `paymentPayload.accepted`와 `paymentRequirements`(scheme/network/asset/amount/payTo)가 같은지
3. **수취인/금액 대조** — `authorization.to`/`authorization.value`가 `paymentRequirements.payTo`/`amount`와 일치하는지
4. **지원 자산 확인** — `paymentRequirements.asset`이 `config/assets.ts`의 `SUPPORTED_ASSETS`에 등록된 주소인지
5. **EIP-712 서명 검증** — `signature`가 `authorization.from` 본인이 서명한 게 맞는지 (`viem`의 `verifyTypedData`, domain은 자체 레지스트리 값만 사용)
6. **유효 시간 확인** — 현재 시각이 `validAfter` ~ `validBefore` 범위 안인지
7. **nonce 재사용(중복 정산) 확인** — 토큰 컨트랙트의 `authorizationState(from, nonce)`를 직접 조회
8. **잔액 확인** — `authorization.from`의 토큰 잔액이 `value` 이상인지 (`balanceOf` 조회, 이 순간의 스냅샷이라 실제 `/settle` 시점엔 달라질 수 있음)

### invalidReason 코드

x402 표준(coinbase/x402 spec) 코드 중 이 엔드포인트에서 실제로 반환되는 값들.

| 코드 | 의미 |
|---|---|
| `invalid_payment_requirements` | `accepted`가 `paymentRequirements`와 안 맞거나, `asset`이 지원 목록에 없음 |
| `invalid_exact_evm_payload_recipient_mismatch` | 수취인(`to`)이 `payTo`와 다름 |
| `invalid_exact_evm_payload_authorization_value_mismatch` | 결제 금액(`value`)이 요구 금액(`amount`)과 다름 |
| `invalid_exact_evm_payload_signature` | 서명이 유효하지 않음 (다른 사람 서명, 변조된 메시지 등) |
| `invalid_exact_evm_payload_authorization_valid_before` | 서명이 만료됨 (`validBefore` 지남) |
| `invalid_exact_evm_payload_authorization_valid_after` | 아직 유효 시작 시각(`validAfter`) 전 |
| `duplicate_settlement` | 이 nonce(authorization)는 이미 온체인에서 정산됨 |
| `insufficient_funds` | 잔액 부족 |

표준 전체 코드 목록은 [[reference-coinbase-core]] 참고 (`coinbase/core/`).

### 참고

- 온체인에 아무것도 실행하지 않으므로 가스비가 들지 않는다.
- 인증 없이 열려있는 엔드포인트 (프로토타입 단계, 추후 추가 예정 — `guide.md` 8번 섹션 참고).

## POST /v1/settle

검증된 결제를 **실제로 온체인에 실행**하는 엔드포인트. Facilitator 운영 지갑이 가스비를 내고 `transferWithAuthorization`을 브로드캐스트한다.

요청 바디는 `/v1/verify`와 완전히 동일한 형식(`paymentPayload` + `paymentRequirements`). 내부적으로 `verifyPayment()`를 다시 한번 실행해서 재검증한 뒤(중간에 다른 요청이 먼저 정산했을 수 있으므로), 통과하면 온체인 트랜잭션을 보낸다.

### 요청

```
POST /v1/settle
Content-Type: application/json
```

`/v1/verify`의 요청 바디와 동일 — 위 섹션 참고.

### 응답

#### 200 — 정산 성공

```json
{
  "success": true,
  "transaction": "0x1234...abcd",
  "network": "base-sepolia",
  "payer": "0x..."
}
```

#### 400 — 정산 실패

```json
{
  "success": false,
  "errorReason": "duplicate_settlement",
  "transaction": "",
  "network": "base-sepolia",
  "payer": "0x..."
}
```

x402 v2 스펙(Section 5.3.2)상 `transaction`/`network`는 실패 시에도 필수 필드라, 트랜잭션을 아예 보내지 못한 경우 `transaction`은 빈 문자열로 채워서 응답한다.

### 처리 순서

`src/services/settlement.service.ts`의 `settlePayment()` 기준.

1. **재검증** — `verifyPayment()`를 그대로 재실행 (서명·유효시간·nonce·잔액 8단계 전부). 실패하면 그 `invalidReason`을 `errorReason`으로 그대로 반환하고 종료
2. **서명 분해** — `signature`를 `transferWithAuthorization`이 요구하는 `v`/`r`/`s`로 분해 (`viem`의 `parseSignature`)
3. **온체인 실행** — Facilitator 지갑(`walletClient`)으로 `transferWithAuthorization`을 호출해 브로드캐스트. 컨펌은 기다리지 않고 브로드캐스트 성공 시점(`txHash` 수신)에 바로 응답

### errorReason 코드

`/v1/verify`의 `invalidReason` 코드에 더해, 온체인 실행 단계에서만 발생하는 것들.

| 코드 | 의미 |
|---|---|
| `duplicate_settlement` | 재검증 이후 트랜잭션을 보냈는데, 그 사이 다른 요청이 먼저 같은 nonce로 정산해서 컨트랙트가 revert됨 |
| `invalid_exact_evm_payload_authorization_valid_after`/`_valid_before` | 컨트랙트 revert 사유가 유효시간 관련으로 확인된 경우 |
| `invalid_exact_evm_payload_signature` | 컨트랙트 revert 사유가 서명 관련으로 확인된 경우 |
| `invalid_transaction_state` | 컨트랙트가 revert했지만 구체적 사유를 알려진 패턴으로 못 찾은 경우 |
| `unexpected_settle_error` | 컨트랙트 revert가 아닌 문제 (RPC 타임아웃, 네트워크 오류, 가스비 부족 등) |

### 참고

- 가스비는 항상 네이티브 토큰(Base는 ETH)으로 나가므로, Facilitator 운영 지갑에 ETH 잔액이 있어야 한다.
- `/verify`와 `/settle` 사이에 시간차가 있을 수 있어서, 재검증에서 통과했더라도 온체인 실행 시점에 다시 실패할 수 있다 (TOCTOU) — 그래서 온체인 revert에 대한 별도 처리가 있다.

## GET /supported

이 Facilitator가 어떤 결제(scheme/network/asset)를 지원하는지 알려주는 x402 표준 discovery 엔드포인트. 리소스 서버가 402 응답에 넣을 `PaymentRequirements`를 만들 때 참고하는 용도.

### 요청

```
GET /supported
```

파라미터 없음.

### 응답

```json
{
  "kinds": [
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "base-sepolia",
      "extra": {
        "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "decimals": 6,
        "eip712Name": "USDC",
        "eip712Version": "2"
      }
    }
  ],
  "extensions": [],
  "signers": {
    "base-sepolia": ["0x..."]
  }
}
```

| 필드 | 설명 |
|---|---|
| `kinds` | 지원하는 결제 조합 목록. `config/assets.ts`의 `SUPPORTED_ASSETS` 하나당 항목 하나 |
| `kinds[].extra` | 해당 자산의 EIP-712 도메인 정보. 리소스 서버가 별도 조회 없이 이 응답만으로 `PaymentRequirements`를 구성할 수 있게 함 |
| `extensions` | 이 Facilitator가 구현한 선택적 확장 기능 목록. 아직 없어서 빈 배열 |
| `signers` | `/v1/settle`을 실제로 실행하는 Facilitator 지갑 주소 (network별) |

### 참고

- 실제 CDP x402 facilitator API(`docs.cdp.coinbase.com`)를 보면 `network`는 `"base-sepolia"`처럼 평범한 문자열과 `"eip155:84532"`(CAIP-2) 둘 다 공식 허용 값이다 — 여기선 프로젝트 다른 곳(`PaymentRequirementsSchema` 등)과의 일관성을 위해 전자를 쓴다. 스펙 이탈이 아님.
- CDP의 `kinds` 예시는 보통 network당 항목 하나(그 네트워크의 기본 자산 하나만 가정)인데, 이 프로젝트는 같은 network(base-sepolia)에서 USDC/KRWH 두 자산을 지원해야 해서 **자산 하나당 kind 하나**로 나눴다 — `network`는 같아도 `extra.asset`/`eip712Name`/`eip712Version`이 자산마다 달라서, 이렇게 안 나누면 리소스 서버가 어느 자산의 도메인 정보인지 구분할 수 없다.
