import nodemailer from "nodemailer";
import { logger } from "./logger";

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn("SMTP not configured — emails will be logged to console only");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const FROM = process.env.SMTP_FROM ?? "no-reply@prawwplus.co.za";

async function sendMail(to: string, subject: string, html: string) {
  const transport = createTransport();
  if (!transport) {
    logger.info({ to, subject }, "EMAIL (console fallback):\n" + html.replace(/<[^>]+>/g, ""));
    return;
  }
  try {
    const info = await transport.sendMail({ from: FROM, to, subject, html });
    logger.info({ to, subject, messageId: info.messageId }, "Email sent successfully");
  } catch (err: any) {
    logger.error({ to, subject, err: err?.message ?? err }, "Failed to send email");
    throw err;
  }
}

export async function sendVerificationEmail(email: string, token: string, baseUrl: string) {
  const link = `${baseUrl}/verify-email?token=${token}`;
  await sendMail(
    email,
    "Verify your PRaww+ email",
    `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f1e;color:#e2e8f0;padding:40px;border-radius:12px">
      <h1 style="color:#3b82f6;font-size:28px;margin-bottom:8px">PRaww+</h1>
      <h2 style="color:#ffffff;font-size:20px;margin-bottom:16px">Verify your email address</h2>
      <p style="color:#94a3b8;margin-bottom:24px">Click the button below to verify your email and activate your account.</p>
      <a href="${link}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px">Verify Email</a>
      <p style="color:#64748b;font-size:12px;margin-top:32px">This link expires in 24 hours. If you didn't sign up, ignore this email.</p>
    </div>
    `,
  );
}

export async function sendPasswordResetEmail(email: string, token: string, baseUrl: string) {
  const link = `${baseUrl}/reset-password?token=${token}`;
  await sendMail(
    email,
    "Reset your PRaww+ password",
    `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f1e;color:#e2e8f0;padding:40px;border-radius:12px">
      <h1 style="color:#3b82f6;font-size:28px;margin-bottom:8px">PRaww+</h1>
      <h2 style="color:#ffffff;font-size:20px;margin-bottom:16px">Reset your password</h2>
      <p style="color:#94a3b8;margin-bottom:24px">Click the button below to reset your password. This link expires in 1 hour.</p>
      <a href="${link}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px">Reset Password</a>
      <p style="color:#64748b;font-size:12px;margin-top:32px">If you didn't request this, ignore this email. Your password won't change.</p>
    </div>
    `,
  );
}
