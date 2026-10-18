import { hash } from "@node-rs/argon2";
import { z } from "zod";

import { createUserFromInvite } from "@/lib/db";

export const runtime = "nodejs";

const registrationSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "用户名至少 3 个字符")
      .max(32, "用户名最多 32 个字符")
      .regex(
        /^[A-Za-z0-9_.-]+$/,
        "用户名只能包含字母、数字、点、下划线和连字符",
      ),
    email: z
      .union([z.string().trim().email("邮箱格式不正确"), z.literal("")])
      .optional(),
    password: z
      .string()
      .min(10, "密码至少 10 个字符")
      .max(128, "密码最多 128 个字符"),
    confirmPassword: z.string(),
    inviteCode: z.string().trim().min(1, "请输入邀请码"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = registrationSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_registration",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const passwordHash = await hash(parsed.data.password, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    const user = createUserFromInvite({
      username: parsed.data.username,
      email: parsed.data.email || undefined,
      passwordHash,
      inviteCode: parsed.data.inviteCode,
    });
    return Response.json(
      {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error: "registration_failed",
        message: error instanceof Error ? error.message : "注册失败",
      },
      { status: 409 },
    );
  }
}
