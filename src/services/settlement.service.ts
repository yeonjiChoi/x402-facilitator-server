import {
  BaseError,
  ContractFunctionRevertedError,
  parseSignature,
  type Address,
  type Hex,
} from "viem";
import { getAssetByAddress } from "../config/assets.js";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResult,
} from "../types/payment.js";
import { verifyPayment } from "./verification.service.js";
import { eip3009Abi, walletClient } from "../config/chain.js";

export async function settlePayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<SettleResult> {
  // 1) 온체인에 실제로 돈을 옮기기 전에, verification.service.ts의 검증 로직을 그대로 재사용해서 한 번 더 확인
  const verifyResult = await verifyPayment(paymentPayload, paymentRequirements);
  if (!verifyResult.isValid) {
    return {
      success: false,
      errorReason: verifyResult.invalidReason,
      transaction: "",
      network: paymentRequirements.network,
      // exactOptionalPropertyTypes: true라 payer가 undefined일 땐 프로퍼티 자체를 생략해야 함
      // (payer: undefined처럼 값만 undefined인 채로 넣는 건 허용 안 됨)
      ...(verifyResult.payer !== undefined
        ? { payer: verifyResult.payer }
        : {}),
    };
  }

  // 2) 검증 통과
  // getAssetByAddress는 verifyPayment 내부(4단계)에서 이미 한 번 성공적으로 조회된 적이 있으므로
  // 여기서 undefined가 나올 수 없음 - non-null 단언(!)으로 처리.
  const asset = getAssetByAddress(paymentRequirements.asset)!;
  const { authorization, signature } = paymentPayload.payload;

  // EIP-712 서명(65바이트 signature)을 transferWithAuthorization이 요구하는 v/r/s 세 값으로 분해
  const { v, r, s } = parseSignature(signature as Hex);

  try {
    // 온체인에 실제로 이체를 실행. Facilitator 지갑(walletClient)이 가스비를 내고 브로드캐스트함.
    // 컨펌까지 기다리지 않고 브로드캐스트가 성공한 시점(txHash를 받은 시점)에 바로 반환 - guide.md 설계대로.
    const txHash = await walletClient.writeContract({
      address: asset.address,
      abi: eip3009Abi,
      functionName: "transferWithAuthorization",
      args: [
        authorization.from as Address,
        authorization.to as Address,
        BigInt(authorization.value),
        BigInt(authorization.validAfter),
        BigInt(authorization.validBefore),
        authorization.nonce as Hex,
        Number(v),
        r,
        s,
      ],
    });

    return {
      success: true,
      transaction: txHash,
      network: paymentRequirements.network,
      payer: authorization.from,
    };
  } catch (err) {
    return {
      success: false,
      errorReason: resolveSettlementErrorReason(err),
      transaction: "", // 스펙상 실패 시에도 필수 필드라 빈 문자열로 채움
      network: paymentRequirements.network,
      payer: authorization.from,
    };
  }
}

// writeContract가 던진 에러를 분석해서 x402 표준 errorReason으로 매핑.
// 우리가 verifyPayment에서 이미 사전 검증을 하지만, verify와 settle 사이의 시간차 동안 상태가 바뀔 수 있어서
// (예: 그 사이 다른 요청이 같은 nonce를 먼저 정산함) 컨트랙트가 실제로 revert하는 경우가 있고,
// 그 revert 사유를 최대한 구체적인 errorReason으로 클라이언트에게 돌려주기 위한 함수.
function resolveSettlementErrorReason(err: unknown): string {
  if (err instanceof BaseError) {
    // viem 에러는 여러 겹으로 래핑돼 있어서, 실제 컨트랙트 revert 정보를 담은
    // ContractFunctionRevertedError를 walk()으로 찾아서 꺼냄
    const revertError = err.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    );
    if (revertError instanceof ContractFunctionRevertedError) {
      const reason = (
        revertError.data?.errorName ??
        revertError.reason ??
        revertError.shortMessage ??
        ""
      ).toLowerCase();

      // EIP-3009 표준 컨트랙트(예: FiatTokenV2)들이 흔히 쓰는 revert 메시지 기준 분기.
      // 컨트랙트마다 문구가 조금씩 다를 수 있어서 키워드 매칭으로 최대한 넓게 잡음.
      if (reason.includes("used") || reason.includes("canceled")) {
        // verify 시점엔 안 쓰였는데, 그 사이 다른 요청이 먼저 이 nonce로 정산해버린 경우
        return "duplicate_settlement";
      }
      if (reason.includes("not yet valid")) {
        return "invalid_exact_evm_payload_authorization_valid_after";
      }
      if (reason.includes("expired")) {
        return "invalid_exact_evm_payload_authorization_valid_before";
      }
      if (reason.includes("signature")) {
        return "invalid_exact_evm_payload_signature";
      }
      // 알려진 패턴에 안 걸리는 revert - 온체인 트랜잭션 자체는 실패로 확정된 상태
      return "invalid_transaction_state";
    }
  }

  // 컨트랙트 revert가 아닌 경우 (RPC 타임아웃, 네트워크 오류, 가스비 부족 등) - x402 표준의 범용 코드
  return "unexpected_settle_error";
}
