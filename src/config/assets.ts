import type { Address } from "viem";
import { env } from "./env.js";

// 결제(x402)에 사용 가능한 자산 하나의 정보. EIP-712 서명 검증에 이름/버전이 필요해서 같이 들고 있음.
export interface AssetConfig {
  symbol: string;
  address: Address;
  decimals: number;
  eip712Name: string;
  eip712Version: string;
}

// 이 서버가 지원하는 결제 자산 목록. env.ts에서 이미 형식 검증된 값을 그대로 옮겨 담기만 함.
// key(USDC/KRWH)로 조회할 땐 이 객체를, 컨트랙트 주소로 역조회할 땐 아래 getAssetByAddress를 사용.
export const SUPPORTED_ASSETS: Record<string, AssetConfig> = {
  USDC: {
    symbol: "USDC",
    address: env.USDC_ADDRESS as Address,
    decimals: env.USDC_DECIMALS,
    eip712Name: env.USDC_EIP712_NAME,
    eip712Version: env.USDC_EIP712_VERSION,
  },
  KRWH: {
    symbol: "KRWH",
    address: env.KRWH_ADDRESS as Address,
    decimals: env.KRWH_DECIMALS,
    eip712Name: env.KRWH_EIP712_NAME,
    eip712Version: env.KRWH_EIP712_VERSION,
  },
};

// 요청/트랜잭션에 찍힌 컨트랙트 주소만 갖고 있을 때, 그게 어떤 지원 자산인지 찾기 위한 함수.
// 주소는 대소문자가 섞여 올 수 있어서 소문자로 맞춰서 비교.
export function getAssetByAddress(address: string): AssetConfig | undefined {
  const lower = address.toLowerCase();
  return Object.values(SUPPORTED_ASSETS).find(
    (a) => a.address.toLowerCase() === lower,
  );
}
