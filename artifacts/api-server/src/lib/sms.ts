import { logger } from "./logger";

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  const twilio = require("twilio");
  return twilio(accountSid, authToken);
}

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

export async function sendSmsOtp(phone: string, otp: string): Promise<void> {
  const client = getTwilioClient();

  if (!client || !FROM_NUMBER) {
    logger.warn(
      { phone },
      "SMS not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER missing) — OTP logged for dev only",
    );
    logger.info({ phone, otp }, "DEV OTP");
    return;
  }

  await client.messages.create({
    body: `Your PRaww+ verification code is: ${otp}\n\nDo not share this code with anyone. It expires in 10 minutes.`,
    from: FROM_NUMBER,
    to: phone,
  });

  logger.info({ phone }, "SMS OTP sent via Twilio");
}
