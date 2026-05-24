/**
 * alertWorker — evaluates AlertRules every 60 seconds against live metrics
 * and fires delivery when thresholds are breached.
 *
 * Metrics evaluated:
 *  - answer_rate           — callsAnswered / callsInitiated (rolling window: since process start)
 *  - ice_failure_rate      — iceFailures / callsInitiated
 *  - ws_disconnect_rate    — wsDisconnectsVerto per minute
 *  - active_calls_drop     — activeCalls dropped to 0 when previously > 0
 *  - call_setup_latency_p95 — p95 latency in ms
 *  - registration_failure_rate — registrationFailures per window
 *  - reconnect_failure_rate — reconnectFailures per window
 *
 * Delivery:
 *  - Slack webhook (POST JSON with text)
 *  - Generic HTTP webhook (POST JSON body)
 *  - Email via SendGrid (if SENDGRID_API_KEY set)
 */

import { randomUUID } from "crypto";
import { connectDB } from "@workspace/db";
import { AlertRuleModel, AlertEventModel, type IAlertRule } from "@workspace/db";
import { metrics } from "./metrics";
import { logger } from "./logger";

const INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let lastActiveCalls = 0;
let prevWsDisconnects = 0;
let prevRegistrationFailures = 0;
let prevReconnectFailures = 0;
let prevCallsInitiated = 0;
let prevWindowStart = Date.now();

// ── Metric evaluators ────────────────────────────────────────────────────────

function currentValue(metric: IAlertRule["metric"]): number {
  const now = Date.now();
  const windowMs = 5 * 60_000; // default 5-min window in ms

  switch (metric) {
    case "answer_rate": {
      const initiated = metrics.callsInitiated;
      return initiated > 0 ? (metrics.callsAnswered / initiated) * 100 : 100;
    }
    case "ice_failure_rate": {
      const initiated = metrics.callsInitiated;
      return initiated > 0 ? (metrics.iceFailures / initiated) * 100 : 0;
    }
    case "ws_disconnect_rate": {
      const elapsed = (now - prevWindowStart) / 60_000;
      const delta = metrics.wsDisconnectsVerto - prevWsDisconnects;
      return elapsed > 0 ? delta / elapsed : 0;
    }
    case "active_calls_drop": {
      return metrics.activeCalls === 0 && lastActiveCalls > 0 ? 1 : 0;
    }
    case "call_setup_latency_p95": {
      return metrics.callSetupLatencyPercentiles().p95;
    }
    case "registration_failure_rate": {
      const elapsed = (now - prevWindowStart) / 60_000;
      const delta = metrics.registrationFailures - prevRegistrationFailures;
      return elapsed > 0 ? delta / elapsed : 0;
    }
    case "reconnect_failure_rate": {
      const elapsed = (now - prevWindowStart) / 60_000;
      const delta = metrics.reconnectFailures - prevReconnectFailures;
      return elapsed > 0 ? delta / elapsed : 0;
    }
    case "esl_disconnect_minutes": {
      return metrics.eslDisconnectedMs() / 60_000;
    }
    default:
      return 0;
  }
}

function conditionBroken(value: number, condition: IAlertRule["condition"], threshold: number): boolean {
  if (condition === "above") return value > threshold;
  if (condition === "below") return value < threshold;
  return false;
}

// ── Delivery ─────────────────────────────────────────────────────────────────

async function deliverSlack(webhookUrl: string, message: string): Promise<void> {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `🚨 *PRaww+ Alert*: ${message}` }),
  });
  if (!resp.ok) throw new Error(`Slack returned ${resp.status}`);
}

async function deliverWebhook(webhookUrl: string, payload: object): Promise<void> {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Webhook returned ${resp.status}`);
}

async function deliverEmail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return;
  const from = process.env.SENDGRID_FROM_EMAIL ?? "alerts@prawwplus.com";
  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: "text/plain", value: text }],
    }),
  });
  if (!resp.ok) throw new Error(`SendGrid returned ${resp.status}`);
}

async function fireAlert(rule: IAlertRule, value: number): Promise<void> {
  const message = `[${rule.name}] ${rule.metric} is ${value.toFixed(2)} — ${rule.condition} threshold ${rule.threshold}`;
  const deliveryErrors: Record<string, string> = {};
  const channelsFired: string[] = [];

  if (rule.channels.slackWebhook) {
    try {
      await deliverSlack(rule.channels.slackWebhook, message);
      channelsFired.push("slack");
    } catch (err: any) {
      deliveryErrors.slack = err?.message ?? "unknown";
      logger.warn({ err, ruleId: rule._id }, "[AlertWorker] Slack delivery failed");
    }
  }

  if (rule.channels.webhookUrl) {
    try {
      await deliverWebhook(rule.channels.webhookUrl, {
        alert: rule.name, metric: rule.metric, value, threshold: rule.threshold,
        condition: rule.condition, message, firedAt: new Date().toISOString(),
      });
      channelsFired.push("webhook");
    } catch (err: any) {
      deliveryErrors.webhook = err?.message ?? "unknown";
      logger.warn({ err, ruleId: rule._id }, "[AlertWorker] Webhook delivery failed");
    }
  }

  if (rule.channels.emailTo) {
    try {
      await deliverEmail(rule.channels.emailTo, `PRaww+ Alert: ${rule.name}`, message);
      channelsFired.push("email");
    } catch (err: any) {
      deliveryErrors.email = err?.message ?? "unknown";
      logger.warn({ err, ruleId: rule._id }, "[AlertWorker] Email delivery failed");
    }
  }

  // Persist alert event
  try {
    await AlertEventModel.create({
      _id:            randomUUID(),
      ruleId:         rule._id,
      ruleName:       rule.name,
      metric:         rule.metric,
      value,
      threshold:      rule.threshold,
      condition:      rule.condition,
      message,
      channels:       channelsFired,
      deliveryErrors: Object.keys(deliveryErrors).length ? deliveryErrors : undefined,
      firedAt:        new Date(),
    });
  } catch (err) {
    logger.warn({ err, ruleId: rule._id }, "[AlertWorker] Failed to persist alert event");
  }

  // Update lastFiredAt to enforce cooldown
  try {
    await AlertRuleModel.findByIdAndUpdate(rule._id, { lastFiredAt: new Date() });
  } catch { /* non-critical */ }

  logger.info({ ruleId: rule._id, metric: rule.metric, value, channels: channelsFired }, "[AlertWorker] Alert fired");
}

// ── Main evaluation loop ─────────────────────────────────────────────────────

async function evaluate(): Promise<void> {
  const now = Date.now();
  try {
    await connectDB();
    const rules = await AlertRuleModel.find({ enabled: true }).lean();

    for (const rule of rules) {
      // Cooldown check
      if (rule.lastFiredAt) {
        const cooldownMs = rule.cooldownMinutes * 60_000;
        if (now - rule.lastFiredAt.getTime() < cooldownMs) continue;
      }

      const value = currentValue(rule.metric);
      if (conditionBroken(value, rule.condition, rule.threshold)) {
        await fireAlert(rule, value);
      }
    }
  } catch (err) {
    logger.warn({ err }, "[AlertWorker] Evaluation cycle failed");
  }

  // Advance rolling-window baselines
  lastActiveCalls = metrics.activeCalls;
  prevWsDisconnects = metrics.wsDisconnectsVerto;
  prevRegistrationFailures = metrics.registrationFailures;
  prevReconnectFailures = metrics.reconnectFailures;
  prevCallsInitiated = metrics.callsInitiated;
  prevWindowStart = now;
}

export function startAlertWorker(): void {
  if (timer) return;
  logger.info("[AlertWorker] Starting (60s interval)");
  timer = setInterval(() => { evaluate().catch(() => {}); }, INTERVAL_MS);
  // Don't hold the process open
  if (typeof timer === "object" && timer && "unref" in timer) (timer as any).unref();
}

export function stopAlertWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
