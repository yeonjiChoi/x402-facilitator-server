// 결제 검증 로직. express/req/res를 모르는 순수 함수로 유지 (guide.md 레이어 규칙).
import { verifyTypedData, type Address, type Hex } from "viem";
import { getAssetByAddress } from "../config/assets.js";
import {
  chain,
  eip3009Abi,
  eip712Types,
  publicClient,
} from "../config/chain.js";
import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResult,
} from "../types/payment.js";

// 클라이언트가 서명한 조건(payload.accepted)과 서버가 실제로 요구한 조건(paymentRequirements)이
// 같은지 대조. 클라이언트가 조건을 몰래 바꿔서 보낼 수 있으므로 반드시 필요한 체크.
function requirementsMatch(
  a: PaymentRequirements,
  b: PaymentRequirements,
): boolean {
  return (
    a.scheme === b.scheme &&
    a.network === b.network &&
    a.asset.toLowerCase() === b.asset.toLowerCase() &&
    a.amount === b.amount &&
    a.payTo.toLowerCase() === b.payTo.toLowerCase()
  );
}

/**
 * 리소스 서버가 요구한 조건(paymentRequirements)과 클라이언트가 보낸 결제 증거(paymentPayload)를
 * 대조/검증해서 이 결제를 그대로 믿고 리소스를 내줘도 되는지 판단하는 함수.
 *
 * 읽기 전용(view) 검증만 수행하며, 아래 순서로 하나라도 실패하면 즉시 isValid: false로 반환한다.
 * @param paymentPayload
 * @param paymentRequirements
 * @returns
 */
export async function verifyPayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<VerifyResult> {
  const { authorization, signature } = paymentPayload.payload;

  // 1) 클라이언트가 서명한 조건 자체가 서버 요구사항과 맞는지 확인
  if (!requirementsMatch(paymentPayload.accepted, paymentRequirements)) {
    return { isValid: false, invalidReason: "invalid_payment_requirements" };
  }

  // 2) 실제 서명 대상(authorization)의 수취인/금액 대조
  if (
    authorization.to.toLowerCase() !== paymentRequirements.payTo.toLowerCase()
  ) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_recipient_mismatch",
      payer: authorization.from,
    };
  }

  if (authorization.value !== paymentRequirements.amount) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_value_mismatch",
      payer: authorization.from,
    };
  }

  // 3) paymentRequirements.asset(토큰 주소)이 우리가 지원하는 자산인지 확인.
  const asset = getAssetByAddress(paymentRequirements.asset);
  if (!asset) {
    // x402 v2 스펙(Section 9)엔 asset 전용 에러 코드가 없음. "invalid_network"는 체인 불일치용이라
    // 의미가 안 맞아서, 요구 조건 자체를 처리 못 한다는 의미의 invalid_payment_requirements 사용.
    return {
      isValid: false,
      invalidReason: "invalid_payment_requirements",
      payer: authorization.from,
    };
  }

  // 4) 서명 검증에 쓸 EIP-712 domain 구성.
  const domain = {
    name: asset.eip712Name,
    version: asset.eip712Version,
    chainId: chain.id,
    verifyingContract: asset.address,
  } as const;

  // 5) EIP-712 서명 검증: signature를 message+domain으로부터 복원한 주소가 address와 일치하는지 확인
  const isValidSignature = await verifyTypedData({
    address: authorization.from as Address, // 서명자로 주장하는 주소 (이 값과 일치해야 통과)
    domain, // 4)에서 만든 도메인
    types: eip712Types, // TransferWithAuthorization 필드 구조 정의
    primaryType: "TransferWithAuthorization", // types 중 실제로 서명된 타입 지정
    message: {
      // 서명 대상이 된 원본 메시지 필드들. authorization의 문자열 값을 EIP-712가 요구하는 타입으로 변환
      from: authorization.from as Address,
      to: authorization.to as Address,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as Hex,
    },
    signature: signature as Hex, // 클라이언트가 보낸 서명값
  });
  if (!isValidSignature) {
    // 서명이 유효하지 않음 (다른 사람 서명, 변조된 메시지, 잘못된 도메인 등)
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_signature",
      payer: authorization.from,
    };
  }

  // 6) 서명 유효 시간(validAfter ~ validBefore) 범위 안에 현재 시각이 있는지 체크.
  // authorization의 시각들은 유닉스 타임스탬프(초) 문자열이라 Date.now()를 1000으로 나눠서 맞춤.
  const now = Math.floor(Date.now() / 1000);
  if (now >= Number(authorization.validBefore)) {
    // 만료됨 (validBefore 지남)
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_valid_before",
      payer: authorization.from,
    };
  }
  if (now < Number(authorization.validAfter)) {
    // 아직 유효 시작 시각(validAfter) 전
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_valid_after",
      payer: authorization.from,
    };
  }

  // 7) nonce 재사용(재생 공격) 여부 확인.
  // DB로 따로 추적하지 않고, EIP-3009 컨트랙트가 온체인에 기록해둔 authorizationState를 직접 조회
  // (from, nonce) 조합이 이미 쓰였으면 true를 반환함.
  const isUsed = await publicClient.readContract({
    address: asset.address,
    abi: eip3009Abi,
    functionName: "authorizationState",
    args: [authorization.from as Address, authorization.nonce as Hex],
  });
  if (isUsed) {
    return {
      isValid: false,
      invalidReason: "duplicate_settlement",
      payer: authorization.from,
    };
  }

  // 8) 결제자(authorization.from)가 amount만큼 낼 잔액이 있는지 컨트랙트에서 직접 조회해서 확인.
  // 주의: 이건 이 순간의 스냅샷일 뿐이라, 실제 온체인 결제(/settle)가 나중에 실행될 때는
  // 그 사이에 잔액이 빠져나가서 달라져 있을 수 있음 (최종 확인은 항상 온체인 실행 시점이 함).
  const balance = await publicClient.readContract({
    address: asset.address,
    abi: eip3009Abi,
    functionName: "balanceOf",
    args: [authorization.from as Address],
  });
  if (BigInt(balance as bigint) < BigInt(authorization.value)) {
    return {
      isValid: false,
      invalidReason: "insufficient_funds",
      payer: authorization.from,
    };
  }

  return { isValid: true, payer: authorization.from };
}
