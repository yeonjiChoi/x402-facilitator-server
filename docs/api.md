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
