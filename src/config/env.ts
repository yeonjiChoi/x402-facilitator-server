import { z } from "zod";

// EVM 주소 형식(0x + 40자리 hex) 검증용 스키마. USDC/KRWH 주소에 공통으로 사용.
const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "유효한 EVM 주소가 아닙니다");

// 앱 구동에 필요한 환경변수의 타입/형식을 정의.
// 여기 없는 변수는 process.env에 있어도 무시되고, 여기 있는 변수는 없으면 검증 실패함.
const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  USDC_ADDRESS: addressSchema,
  USDC_DECIMALS: z.coerce.number(),
  USDC_EIP712_NAME: z.string(),
  USDC_EIP712_VERSION: z.string(),

  KRWH_ADDRESS: addressSchema,
  KRWH_DECIMALS: z.coerce.number(),
  KRWH_EIP712_NAME: z.string(),
  KRWH_EIP712_VERSION: z.string(),

  FACILITATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "유효한 프라이빗키가 아닙니다"),
});

// 위 스키마로부터 타입을 추론 (스키마와 타입이 어긋날 일이 없음)
export type Env = z.infer<typeof EnvSchema>;

// 주의: process.env를 검증만 할 뿐, .env 파일을 직접 읽어오지는 않음.
// .env 값을 실제로 불러오려면 Node의 --env-file 플래그나 dotenv 같은 패키지가 별도로 필요함.
export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // 필수 값이 없거나 형식이 틀리면 서버를 아예 띄우지 않고 즉시 종료
    console.error("환경변수 검증 실패:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

// 앱 전체에서 하나만 로드해서 공유 (여러 파일에서 loadEnv()를 각자 부르지 않도록)
export const env = loadEnv();
