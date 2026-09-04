import { Router } from "express";
import { VerifyRequestSchema } from "../types/payment.js";
import { verifyPayment } from "../services/verification.service.js";

const router = Router();

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

export default router;
