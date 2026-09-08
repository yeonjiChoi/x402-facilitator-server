import { Router } from "express";
import { SettleRequestSchema, VerifyRequestSchema } from "../types/payment.js";
import { verifyPayment } from "../services/verification.service.js";
import { settlePayment } from "../services/settlement.service.js";
import { SUPPORTED_ASSETS } from "../config/assets.js";
import { walletClient } from "../config/chain.js";

const router = Router();

// 서버 생존 확인용.
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 이 Facilitator가 어떤 결제(scheme/network/asset)를 지원하는지 알려주는 x402 표준 discovery 엔드포인트.
// 리소스 서버가 402 응답에 넣을 PaymentRequirements를 만들 때 참고하는 용도.
router.get("/v1/supported", (_req, res) => {
  // 지원 자산(SUPPORTED_ASSETS) 하나당 kind 하나. asset별 EIP-712 도메인 정보를 extra에 실어서
  // 리소스 서버가 별도 조회 없이 이 응답만으로 PaymentRequirements를 구성할 수 있게 함.
  // 참고: x402 v2 스펙(Section 7.3)의 network 필드는 CAIP-2 형식(예: "eip155:84532")을 쓰지만,
  // 이 프로젝트는 다른 곳(PaymentRequirementsSchema 등)과의 일관성을 위해 "base-sepolia" 문자열을 그대로 씀.
  const kinds = Object.values(SUPPORTED_ASSETS).map((asset) => ({
    x402Version: 1,
    scheme: "exact" as const,
    network: "base-sepolia",
    extra: {
      asset: asset.address,
      decimals: asset.decimals,
      eip712Name: asset.eip712Name,
      eip712Version: asset.eip712Version,
    },
  }));

  res.json({
    kinds,
    extensions: [], // 아직 구현한 확장 기능 없음 - x402 스펙상 kinds/extensions/signers 셋 다 필수 필드
    // /settle을 실제로 실행하는 지갑 주소. 리소스 서버가 신뢰할 서명 주체를 알 수 있게 노출.
    signers: { "base-sepolia": [walletClient.account.address] },
  });
});

// 결제 서명이 유효한지만 확인하는 엔드포인트.
router.post("/v1/verify", async (req, res) => {
  // 요청 바디가 스키마와 안 맞으면 실제 검증 로직을 타기 전에 바로 400 반환
  const parsed = VerifyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ isValid: false, invalidReason: "malformed_request" });
  }

  const result = await verifyPayment(
    parsed.data.paymentPayload,
    parsed.data.paymentRequirements,
  );

  return res.status(result.isValid ? 200 : 400).json(result);
});

// 검증된 결제를 실제로 온체인에 전송하는 엔드포인트
router.post("/v1/settle", async (req, res) => {
  const parsed = SettleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, errorReason: "malformed_request" });
  }

  const result = await settlePayment(
    parsed.data.paymentPayload,
    parsed.data.paymentRequirements,
  );
  return res.status(result.success ? 200 : 400).json(result);
});

export default router;
