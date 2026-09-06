import { z } from "zod";

// Validated environment loader (T-003). Import `env` from here — never read
// process.env directly in app code. Boot fails fast with every problem listed.

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z
    .string()
    .default("Backstage <backstage@example.com>"),
  UPLOADS_DIR: z.string().default("./uploads"),
  // Dataroom storage (EPIC-017). Kept apart from UPLOADS_DIR: this lives on
  // the 3.6 TB spinning disk, while uploads stays on NVMe with the small hot
  // files and the WhatsApp session.
  DATAROOM_DIR: z.string().default(""),
  // installation branding — first-boot defaults; editable later in Admin
  ORG_NAME: z.string().default(""),
  ORG_SHORT_NAME: z.string().default(""),
  PRODUCT_NAME: z.string().default(""),
  ASSISTANT_NAME: z.string().default(""),
  // WhatsApp gateway (EPIC-015)
  WHATSAPP_SESSION_DIR: z.string().default(""),
  WHATSAPP_COUNTRY_CODE: z.string().default("62"),
  // AI assistant (EPIC-014). Since 2026-09-06 the key normally lives in
  // Settings → Integrations (src/lib/ai/provider.ts); these are the fallback
  // for installs configured the old way. Empty = no fallback.
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-5.6"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${problems}\nSee .env.example for the required variables.`,
    );
  }
  return result.data;
}

// Lazy singleton: validated on first access (so importing this module in tests
// with a bare environment doesn't throw), but any real use still fails fast.
let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

export const env: Env = new Proxy({} as Env, {
  get(_target, key) {
    return getEnv()[key as keyof Env];
  },
});
