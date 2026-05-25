/**
 * Typed FreeSWITCH ESL event header models.
 *
 * FreeSWITCH sends all event headers as plain strings.  These interfaces
 * describe the shape of the most critical events so call-lifecycle code can
 * reference header names safely rather than using magic strings everywhere.
 *
 * Usage:
 *   import type { EslChannelHangupHeaders } from "./eslEventTypes";
 *   const h = body as Partial<EslChannelHangupHeaders>;
 *   const cause = h["Hangup-Cause"] ?? "";
 *
 * All fields are typed as `string | undefined` — FreeSWITCH may omit any
 * header depending on the call direction, codec, dialplan context, or FS version.
 */

// ─── Canonical event name union ───────────────────────────────────────────────

export type EslEventName =
  | "CHANNEL_CREATE"
  | "CHANNEL_DESTROY"
  | "CHANNEL_ORIGINATE"
  | "CHANNEL_PROGRESS"
  | "CHANNEL_PROGRESS_MEDIA"
  | "CHANNEL_ANSWER"
  | "CHANNEL_BRIDGE"
  | "CHANNEL_UNBRIDGE"
  | "CHANNEL_HANGUP"
  | "CHANNEL_HANGUP_COMPLETE"
  | "BACKGROUND_JOB"
  | "MESSAGE_WAITING"
  | "CUSTOM";

// ─── Common channel headers (present on most CHANNEL_* events) ───────────────

export interface EslCommonHeaders {
  "Event-Name":              string;
  "Core-UUID":               string | undefined;
  "Event-Date-Timestamp":    string | undefined;
  "Event-Sequence":          string | undefined;
  "Unique-ID":               string | undefined;
  "Call-Direction":          "inbound" | "outbound" | string | undefined;
  "Channel-Name":            string | undefined;
  "Answer-State":            "ringing" | "early" | "answered" | "hangup" | string | undefined;
  "Caller-Caller-ID-Number": string | undefined;
  "Caller-Destination-Number": string | undefined;
  "Caller-Context":          string | undefined;
  "Caller-Dialplan":         string | undefined;
  "Caller-Network-Addr":     string | undefined;
  "Caller-Profile-Index":    string | undefined;
  "Channel-Destination-Number": string | undefined;
  "Channel-Caller-ID-Number": string | undefined;
  "Other-Leg-Unique-ID":     string | undefined;
}

// ─── CHANNEL_ORIGINATE ────────────────────────────────────────────────────────

export interface EslOriginateHeaders extends EslCommonHeaders {
  "Event-Name": "CHANNEL_ORIGINATE";
  "variable_origination_uuid": string | undefined;
}

// ─── CHANNEL_ANSWER ───────────────────────────────────────────────────────────

export interface EslAnswerHeaders extends EslCommonHeaders {
  "Event-Name": "CHANNEL_ANSWER";
  "variable_answer_state":    string | undefined;
  "variable_billsec":         string | undefined;
  "variable_media_ms":        string | undefined;
}

// ─── CHANNEL_BRIDGE / CHANNEL_UNBRIDGE ───────────────────────────────────────

export interface EslBridgeHeaders extends EslCommonHeaders {
  "Event-Name":               "CHANNEL_BRIDGE" | "CHANNEL_UNBRIDGE";
  "Bridge-B-Unique-ID":       string | undefined;
  "variable_effective_caller_id_number": string | undefined;
}

// ─── CHANNEL_HANGUP / CHANNEL_HANGUP_COMPLETE ─────────────────────────────────

export interface EslHangupHeaders extends EslCommonHeaders {
  "Event-Name":                      "CHANNEL_HANGUP" | "CHANNEL_HANGUP_COMPLETE";
  "Hangup-Cause":                    string | undefined;
  "variable_hangup_cause":           string | undefined;
  "variable_billsec":                string | undefined;
  "billsec":                         string | undefined;
  "variable_answer_state":           string | undefined;
  "variable_sip_term_status":        string | undefined;
  "variable_sip_term_cause":         string | undefined;
  "variable_sip_hangup_disposition": string | undefined;
  "sip_hangup_disposition":          string | undefined;
  "variable_endpoint_disposition":   string | undefined;
  "variable_originate_disposition":  string | undefined;
  "variable_last_bridge_hangup_cause": string | undefined;
  "variable_sip_invite_failure_status": string | undefined;
}

// ─── CHANNEL_PROGRESS / CHANNEL_PROGRESS_MEDIA ───────────────────────────────

export interface EslProgressHeaders extends EslCommonHeaders {
  "Event-Name": "CHANNEL_PROGRESS" | "CHANNEL_PROGRESS_MEDIA";
  "variable_answer_state":   string | undefined;
  "variable_sip_term_status": string | undefined;
}

// ─── CHANNEL_DESTROY ──────────────────────────────────────────────────────────

export interface EslDestroyHeaders extends EslCommonHeaders {
  "Event-Name":              "CHANNEL_DESTROY";
  "Hangup-Cause":            string | undefined;
  "variable_hangup_cause":   string | undefined;
  "variable_answer_state":   string | undefined;
  "variable_billsec":        string | undefined;
}

// ─── BACKGROUND_JOB ───────────────────────────────────────────────────────────

export interface EslBackgroundJobHeaders {
  "Event-Name": "BACKGROUND_JOB";
  "Job-UUID":   string | undefined;
  "Job-Command": string | undefined;
}

// ─── MESSAGE_WAITING (MWI) ───────────────────────────────────────────────────

export interface EslMwiHeaders {
  "Event-Name":              "MESSAGE_WAITING";
  "MWI-Messages-Waiting":    string | undefined;
  "Messages-Waiting":        string | undefined;
  "MWI-Account":             string | undefined;
  "mwi-account":             string | undefined;
}

// ─── CUSTOM sofia::register / sofia::unregister ──────────────────────────────

export interface EslSofiaRegisterHeaders {
  "Event-Name":    "CUSTOM";
  "Event-Subclass": "sofia::register" | "sofia::pre-register" | "sofia::unregister" | "sofia::expire" | string;
  "sip-to-user":   string | undefined;
  "from-user":     string | undefined;
  "sip-username":  string | undefined;
  "expires":       string | undefined;
  "contact":       string | undefined;
  "sip-contact":   string | undefined;
  "network-ip":    string | undefined;
  "sip-network-ip": string | undefined;
}

// ─── Discriminated union of all supported ESL event shapes ───────────────────

export type EslTypedEvent =
  | EslOriginateHeaders
  | EslAnswerHeaders
  | EslBridgeHeaders
  | EslHangupHeaders
  | EslProgressHeaders
  | EslDestroyHeaders
  | EslBackgroundJobHeaders
  | EslMwiHeaders
  | EslSofiaRegisterHeaders;

// ─── Safe header accessor ─────────────────────────────────────────────────────

/**
 * Coerce a raw ESL body (Record<string, string>) to a Partial typed view.
 * Use to access typed headers with IntelliSense without runtime overhead.
 *
 * Example:
 *   const h = asEslHeaders<EslHangupHeaders>(body);
 *   const cause = h["Hangup-Cause"] ?? "";
 */
export function asEslHeaders<T extends object>(
  raw: Record<string, string>,
): Partial<T> {
  return raw as unknown as Partial<T>;
}
