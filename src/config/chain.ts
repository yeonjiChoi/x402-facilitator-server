import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { env } from "./env.js";

// 이 서버는 base-sepolia 고정. 다른 체인을 지원할 계획이 생기면 그때 env로 바꿔도 됨.
export const chain = baseSepolia;

// 체인 조회 전용(읽기 전용) RPC 클라이언트. 잔액 조회, authorizationState 확인 등에 사용.
export const publicClient: PublicClient<Transport, typeof chain> =
  createPublicClient({
    chain,
    transport: http(), // 인자 없으면 chain에 정의된 기본 RPC(https://sepolia.base.org) 사용
  });

// Facilitator가 운영하는 지갑 계정. FACILITATOR_PRIVATE_KEY로 서명 주체를 만듦.
// env.ts에서 이미 정규식(`^0x[a-fA-F0-9]{64}$`)으로 형식을 검증했지만, zod가 추론하는 타입은 그냥 string이라
// privateKeyToAccount가 요구하는 `0x${string}` 템플릿 리터럴 타입으로 맞춰주기 위해 as 캐스팅.
const facilitatorAccount = privateKeyToAccount(
  env.FACILITATOR_PRIVATE_KEY as `0x${string}`,
);

// 쓰기(트랜잭션 전송) 가능한 클라이언트. publicClient와 달리 facilitatorAccount가 묶여 있어서
// writeContract 등으로 실제 온체인 트랜잭션에 서명/브로드캐스트할 수 있음 (가스비는 이 지갑이 부담).
export const walletClient: WalletClient<Transport, typeof chain, Account> =
  createWalletClient({
    account: facilitatorAccount,
    chain,
    transport: http(),
  });

// EIP-3009 (transferWithAuthorization) 컨트랙트에서 서명 재사용 방지 여부와 잔액을 확인하기 위한 최소 ABI.
// 전체 ERC20 ABI 대신 실제로 호출하는 함수만 선언 (authorizationState: nonce 사용 여부, balanceOf: 잔액)
export const eip3009Abi = [
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

// EIP-712 서명 검증에 쓰이는 TransferWithAuthorization 타입 정의.
// 사용자가 서명한 메시지를 재구성/검증할 때 각 필드의 이름과 solidity 타입이 이 순서와 일치해야 함.
export const eip712Types = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
