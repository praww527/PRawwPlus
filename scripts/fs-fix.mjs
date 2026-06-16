/**
 * FreeSWITCH Config Fix Script
 *
 * Fixes identified issues:
 *  1. Deploys the "prawwplus" dialplan context (was missing → calls failed)
 *  2. Deploys the prawwplus_mobile SIP profile with ws-binding:5066
 *  3. Removes ESL port 8021 from public iptables
 *  4. Reloads FreeSWITCH XML config and restarts affected profiles
 */

import { Client as SSHClient } from "ssh2";

// ── SSH helpers ──────────────────────────────────────────────────────────────

function cleanPrivateKey(raw) {
  let s = raw.trim();
  if (s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const hm = s.match(/(-----BEGIN [^-]+-----)/);
    const fm = s.match(/(-----END [^-]+-----)/);
    if (hm && fm) {
      const header = hm[1], footer = fm[1];
      const body = s.slice(s.indexOf(header) + header.length, s.indexOf(footer)).replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
      s = `${header}\n${body}\n${footer}`;
    }
  }
  return s.split("\n").map(l => l.trimStart()).join("\n").trim();
}

function bareHost(raw) {
  try { if (/^[a-z]+:\/\//i.test(raw)) return new URL(raw).hostname; } catch {}
  return raw.split(":")[0].replace(/\/$/, "");
}

function sshConnect(host, user, port, privateKey) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect({ host, port, username: user, privateKey, readyTimeout: 15000 });
  });
}

function execCommand(conn, cmd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let out = "", err = "", settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ out: out || "(timeout)", err, exit: -1 }); }
    }, timeoutMs);
    conn.exec(cmd, (e, stream) => {
      if (e) { clearTimeout(timer); resolve({ out: "", err: e.message, exit: -1 }); return; }
      stream.on("data", d => out += d);
      stream.stderr.on("data", d => err += d);
      stream.on("close", code => { if (!settled) { settled = true; clearTimeout(timer); resolve({ out, err, exit: code }); } });
    });
  });
}

async function run(conn, label, cmd, timeoutMs = 30000) {
  console.log(`\n▶ ${label}`);
  const { out, err, exit } = await execCommand(conn, cmd, timeoutMs);
  if (out.trim()) console.log(out.trim());
  if (err.trim() && !err.includes("WARNING") && !err.includes("No chain/target")) console.log(`  STDERR: ${err.trim()}`);
  console.log(`  Exit: ${exit}`);
  return { out: out.trim(), err: err.trim(), exit };
}

// ── XML config generators ────────────────────────────────────────────────────

function xmlEscape(v) {
  return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function dialplanXml(fsDomain, apiPort, pstnGateway) {
  const V = "${";  // FS variable expansion prefix
  const lookupUrl = `http://127.0.0.1:${apiPort}/api/freeswitch/lookup`;

  const externalRoute = pstnGateway
    ? `
    <extension name="external_pstn_numbers" continue="false">
      <condition field="destination_number" expression="^(\\+?[0-9]{7,15})$">
        <action application="set" data="effective_caller_id_name=${V}default(${V}user_data(${V}caller_id_number}@${fsDomain} var effective_caller_id_name)},${V}caller_id_name})}"/>
        <action application="set" data="effective_caller_id_number=${V}default(${V}user_data(${V}caller_id_number}@${fsDomain} var effective_caller_id_number)},${V}caller_id_number})}"/>
        <action application="set" data="outbound_caller_id_name=${V}default(${V}user_data(${V}caller_id_number}@${fsDomain} var outbound_caller_id_name)},${V}caller_id_name})}"/>
        <action application="set" data="outbound_caller_id_number=${V}default(${V}user_data(${V}caller_id_number}@${fsDomain} var outbound_caller_id_number)},${V}caller_id_number})}"/>
        <action application="set" data="call_timeout=45"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="set" data="continue_on_fail=false"/>
        <action application="set" data="pstn_dest=$1"/>
        <action application="set" data="pstn_dest=${V}default(${V}regex(${V}pstn_dest}|^0([0-9]{9})$|+27$1)},${V}pstn_dest})}"/>
        <action application="set" data="pstn_dest=${V}default(${V}regex(${V}pstn_dest}|^27([0-9]{9})$|+27$1)},${V}pstn_dest})}"/>
        <action application="log" data="INFO [PSTN-BRIDGE] rawDest=$1 normalizedDest=${V}pstn_dest}"/>
        <action application="answer"/>
        <action application="speak" data="flite|kal|Please note. You are calling a number outside the PRaww app. This call will be billed to your account."/>
        <action application="sleep" data="500"/>
        <action application="bridge" data="sofia/gateway/${xmlEscape(pstnGateway)}/${V}pstn_dest}"/>
      </condition>
    </extension>
`
    : `
    <extension name="external_pstn_not_configured" continue="false">
      <condition field="destination_number" expression="^(\\+?[0-9]{7,15})$">
        <action application="log" data="ERR External PSTN call rejected: PSTN_GATEWAY_NAME not configured"/>
        <action application="answer"/>
        <action application="speak" data="flite|kal|External calling is not configured yet."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="NO_ROUTE_DESTINATION"/>
      </condition>
    </extension>
`;

  return `<include>
  <!--
    PRawwPlus Dialplan — domain: ${fsDomain}
    Context: "prawwplus" — isolated from the built-in "default" context.
    Both Verto (port 8081) and SIP/WS (port 5066) profiles use this context.
  -->
  <context name="prawwplus">

    <!-- Conference rooms — conf + 4 digits (e.g. conf1234) -->
    <extension name="conference_rooms" continue="false">
      <condition field="destination_number" expression="^(conf\\d{4})$">
        <action application="answer"/>
        <action application="conference" data="$1@default+flags{mute}"/>
      </condition>
    </extension>

    <!-- Self-call prevention -->
    <extension name="self_call_prevention" continue="false">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$" break="never">
        <action application="noop"/>
      </condition>
      <condition field="${V}caller_id_number}" expression="^${V}destination_number}$" break="on-true">
        <action application="answer"/>
        <action application="speak" data="flite|kal|You cannot call your own extension."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="CALL_REJECTED"/>
      </condition>
    </extension>

    <!-- DND check -->
    <extension name="dnd_reject" continue="true">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$" break="never">
        <action application="set" data="callee_dnd=${V}user_data($1@${fsDomain} var dnd)}"/>
      </condition>
      <condition field="${V}callee_dnd}" expression="^true$" break="on-true">
        <action application="answer"/>
        <action application="speak" data="flite|kal|The person you are calling is not available."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="CALL_REJECTED"/>
      </condition>
    </extension>

    <!-- Internal extension-to-extension calls (1000-9999) -->
    <extension name="internal_extensions" continue="true">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$" break="on-false">
        <action application="set" data="effective_caller_id_name=${V}default(${V}user_data(${V}caller_id_number}@${fsDomain} var effective_caller_id_name)},${V}caller_id_name})}"/>
        <action application="set" data="effective_caller_id_number=${V}default(${V}user_data(${V}caller_id_number}@${fsDomain} var effective_caller_id_number)},${V}caller_id_number})}"/>
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=false"/>
        <action application="set" data="continue_on_fail=true"/>
        <action application="set" data="forward_depth=${V}default(${V}forward_depth},0)}"/>
        <action application="set" data="ringback=${V}us-ring}"/>
        <action application="set" data="transfer_ringback=${V}us-ring}"/>
        <action application="set" data="RECORD_STEREO=true"/>
        <action application="record_session" data="$\${recordings_dir}/calls/call_${V}caller_id_number}_${V}destination_number}_${V}unique_id}.wav"/>

        <!-- Always-forward check -->
        <action application="set" data="forward_target=${V}user_data($1@${fsDomain} var callForwardAlwaysTo)}"/>
        <action application="set" data="forward_enabled=${V}user_data($1@${fsDomain} var callForwardAlwaysEnabled)}"/>
        <action application="set" data="should_forward=${V}regex(${V}forward_enabled}|^true$)}"/>
        <action application="set" data="should_forward=${V}expr(${V}should_forward} &amp;&amp; ${V}strlen(${V}forward_target}) &gt; 0 &amp;&amp; ${V}forward_depth} &lt; 3)}"/>
        <action application="set" data="should_forward=${V}expr(${V}should_forward} &amp;&amp; '${V}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${V}expr(${V}forward_depth}+1)}"/>
        <action application="set" data="execute_forward=${V}expr(${V}should_forward})"/>
        <action application="set" data="forward_is_ext=${V}regex(${V}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${V}regex(${V}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${V}regex(${V}forward_target}|^\\+?[1-9][0-9]{6,14}$)}"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="set" data="fwd_verto_ep=${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_ext} == 1?${V}verto_contact(${V}forward_target}@${fsDomain})}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_ext} == 1?${V}if(${V}fwd_verto_ep}?${V}fwd_verto_ep},user/${V}forward_target}@${fsDomain}:user/${V}forward_target}@${fsDomain})}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_sip} == 1?${V}forward_target}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_num} == 1?loopback/${V}forward_target}/prawwplus:)}"/>
        <action application="set" data="hangup_after_bridge=false"/>

        <!--
          Main bridge: Verto (web/WebRTC) AND SIP/WS (mobile) simultaneously.
          verto_contact() is an API function — MUST be used via variable expansion.
          Pre-compute to avoid leading comma when browser is offline.
        -->
        <action application="set" data="verto_ep=${V}verto_contact(\$1@${fsDomain})}"/>
        <action application="bridge" data="${V}if(${V}verto_ep}?${V}verto_ep},user/\$1@${fsDomain}:user/\$1@${fsDomain})}"/>

        <!-- Save bridge cause before forwarding blocks can overwrite it -->
        <action application="set" data="_orig_bridge_cause=${V}bridge_hangup_cause}"/>
      </condition>

      <!-- Busy forwarding -->
      <condition field="${V}_orig_bridge_cause}" expression="^USER_BUSY$" break="never">
        <action application="set" data="forward_depth=${V}default(${V}forward_depth},0)}"/>
        <action application="set" data="forward_target=${V}user_data($1@${fsDomain} var callForwardBusyTo)}"/>
        <action application="set" data="forward_enabled=${V}user_data($1@${fsDomain} var callForwardBusyEnabled)}"/>
        <action application="set" data="execute_forward=${V}expr(${V}regex(${V}forward_enabled}|^true$) &amp;&amp; ${V}strlen(${V}forward_target}) &gt; 0 &amp;&amp; ${V}forward_depth} &lt; 3 &amp;&amp; '${V}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${V}expr(${V}forward_depth}+1)}"/>
        <action application="set" data="forward_is_ext=${V}regex(${V}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${V}regex(${V}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${V}regex(${V}forward_target}|^\\+?[1-9][0-9]{6,14}$)}"/>
        <action application="set" data="fwd_verto_ep=${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_ext} == 1?${V}verto_contact(${V}forward_target}@${fsDomain})}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_ext} == 1?${V}if(${V}fwd_verto_ep}?${V}fwd_verto_ep},user/${V}forward_target}@${fsDomain}:user/${V}forward_target}@${fsDomain})}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_sip} == 1?${V}forward_target}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_num} == 1?loopback/${V}forward_target}/prawwplus:)}"/>
      </condition>
      <condition field="${V}_orig_bridge_cause}" expression="^USER_BUSY$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(500,500,480,620);loops=4"/>
        <action application="speak" data="flite|kal|The number you are calling is currently busy. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="USER_BUSY"/>
      </condition>

      <!-- No-answer forwarding -->
      <condition field="${V}_orig_bridge_cause}" expression="^(NO_ANSWER|RECOVERY_ON_TIMER_EXPIRE)$" break="never">
        <action application="set" data="forward_depth=${V}default(${V}forward_depth},0)}"/>
        <action application="set" data="forward_target=${V}user_data($1@${fsDomain} var callForwardNoAnswerTo)}"/>
        <action application="set" data="forward_enabled=${V}user_data($1@${fsDomain} var callForwardNoAnswerEnabled)}"/>
        <action application="set" data="execute_forward=${V}expr(${V}regex(${V}forward_enabled}|^true$) &amp;&amp; ${V}strlen(${V}forward_target}) &gt; 0 &amp;&amp; ${V}forward_depth} &lt; 3 &amp;&amp; '${V}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${V}expr(${V}forward_depth}+1)}"/>
        <action application="set" data="forward_is_ext=${V}regex(${V}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${V}regex(${V}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${V}regex(${V}forward_target}|^\\+?[1-9][0-9]{6,14}$)}"/>
        <action application="set" data="fwd_verto_ep=${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_ext} == 1?${V}verto_contact(${V}forward_target}@${fsDomain})}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_ext} == 1?${V}if(${V}fwd_verto_ep}?${V}fwd_verto_ep},user/${V}forward_target}@${fsDomain}:user/${V}forward_target}@${fsDomain})}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_sip} == 1?${V}forward_target}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_num} == 1?loopback/${V}forward_target}/prawwplus:)}"/>
      </condition>
      <condition field="${V}_orig_bridge_cause}" expression="^(NO_ANSWER|RECOVERY_ON_TIMER_EXPIRE)$" break="on-true">
        <action application="answer"/>
        <action application="voicemail" data="default ${fsDomain} $1"/>
        <action application="hangup" data="ATTENDED_TRANSFER"/>
      </condition>

      <!-- Cancelled by caller -->
      <condition field="${V}_orig_bridge_cause}" expression="^(ORIGINATOR_CANCEL|NORMAL_CLEARING)$" break="on-true">
        <action application="hangup" data="${V}_orig_bridge_cause}"/>
      </condition>

      <!-- Unavailable forwarding -->
      <condition field="${V}_orig_bridge_cause}" expression="^(UNREGISTERED|USER_NOT_REGISTERED|SUBSCRIBER_ABSENT|DESTINATION_OUT_OF_ORDER)$" break="never">
        <action application="set" data="forward_depth=${V}default(${V}forward_depth},0)}"/>
        <action application="set" data="forward_target=${V}user_data($1@${fsDomain} var callForwardUnavailableTo)}"/>
        <action application="set" data="forward_enabled=${V}user_data($1@${fsDomain} var callForwardUnavailableEnabled)}"/>
        <action application="set" data="execute_forward=${V}expr(${V}regex(${V}forward_enabled}|^true$) &amp;&amp; ${V}strlen(${V}forward_target}) &gt; 0 &amp;&amp; ${V}forward_depth} &lt; 3 &amp;&amp; '${V}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${V}expr(${V}forward_depth}+1)}"/>
        <action application="set" data="forward_is_ext=${V}regex(${V}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${V}regex(${V}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${V}regex(${V}forward_target}|^\\+?[1-9][0-9]{6,14}$)}"/>
        <action application="set" data="fwd_verto_ep=${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_ext} == 1?${V}verto_contact(${V}forward_target}@${fsDomain})}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_ext} == 1?${V}if(${V}fwd_verto_ep}?${V}fwd_verto_ep},user/${V}forward_target}@${fsDomain}:user/${V}forward_target}@${fsDomain})}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_sip} == 1?${V}forward_target}:)}"/>
        <action application="bridge" data="${V}if(${V}execute_forward} == 1 &amp;&amp; ${V}forward_is_num} == 1?loopback/${V}forward_target}/prawwplus:)}"/>
      </condition>
      <!-- Hold window (30 s) then SIT tone for unavailable -->
      <condition field="${V}_orig_bridge_cause}" expression="^(UNREGISTERED|USER_NOT_REGISTERED|SUBSCRIBER_ABSENT|DESTINATION_OUT_OF_ORDER)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(2000,4000,440,480);loops=5"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=3"/>
        <action application="speak" data="flite|kal|The number you have dialed is currently unavailable. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="UNREGISTERED"/>
      </condition>

      <!-- Unknown bridge failure -->
      <condition field="${V}_orig_bridge_cause}" expression="^(.+)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=2"/>
        <action application="speak" data="flite|kal|The call could not be completed. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="${V}_orig_bridge_cause}"/>
      </condition>
    </extension>

    <!-- Phone-number lookup (SA mobile → internal extension) -->
    <extension name="phone_number_lookup" continue="true">
      <condition field="destination_number" expression="^(0[0-9]{9})$" break="never">
        <action application="curl" data="${lookupUrl}?number=$1"/>
        <action application="set" data="target_ext=${V}curl_response_data}"/>
        <action application="log" data="INFO [LOOKUP] ${V}destination_number} → target_ext=${V}target_ext} (http ${V}curl_response_code})"/>
      </condition>
      <condition field="${V}target_ext}" expression="^([1-9][0-9]{3})$" break="on-true">
        <action application="transfer" data="${V}target_ext} XML prawwplus"/>
      </condition>
    </extension>

${externalRoute}

    <!-- Voicemail self-check: *97 -->
    <extension name="voicemail_self">
      <condition field="destination_number" expression="^\\*97$">
        <action application="answer"/>
        <action application="voicemail" data="check default ${fsDomain} ${V}caller_id_number}"/>
      </condition>
    </extension>

    <!-- Voicemail other: *98EXTN -->
    <extension name="voicemail_other">
      <condition field="destination_number" expression="^\\*98([1-9][0-9]{3})$">
        <action application="answer"/>
        <action application="voicemail" data="check default ${fsDomain} $1"/>
      </condition>
    </extension>

    <!-- Invalid / unallocated destination -->
    <extension name="invalid_number">
      <condition field="destination_number" expression="^(.*)$">
        <action application="log" data="WARNING Rejected unmatched destination: \$1"/>
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=2"/>
        <action application="speak" data="flite|kal|The number you have dialed does not exist. Please check the number and try again."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="NO_ROUTE_DESTINATION"/>
      </condition>
    </extension>

  </context>
</include>`;
}

function sipProfileXml(fsIp, pstnGateway) {
  const gwXml = pstnGateway ? `
    <gateway name="${xmlEscape(pstnGateway)}">
      <param name="username" value="${xmlEscape(process.env.PSTN_GATEWAY_USERNAME ?? "")}"/>
      <param name="password" value="${xmlEscape(process.env.PSTN_GATEWAY_PASSWORD ?? "")}"/>
      <param name="proxy" value="${xmlEscape(process.env.PSTN_GATEWAY_PROXY ?? "")}"/>
      <param name="realm" value="${xmlEscape(process.env.PSTN_GATEWAY_REALM ?? process.env.PSTN_GATEWAY_PROXY ?? "")}"/>
      <param name="from-domain" value="${xmlEscape(process.env.PSTN_GATEWAY_FROM_DOMAIN ?? process.env.PSTN_GATEWAY_PROXY ?? "")}"/>
      <param name="register" value="${xmlEscape(process.env.PSTN_GATEWAY_REGISTER ?? "true")}"/>
      <param name="expire-seconds" value="300"/>
      <param name="retry-seconds" value="30"/>
    </gateway>` : "";

  return `<profile name="prawwplus_mobile">
  <settings>
    <param name="context" value="prawwplus"/>
    <param name="dialplan" value="XML"/>
    <param name="sip-ip" value="0.0.0.0"/>
    <param name="ext-sip-ip" value="${fsIp}"/>
    <param name="sip-port" value="5068"/>
    <param name="rtp-ip" value="0.0.0.0"/>
    <param name="ext-rtp-ip" value="${fsIp}"/>
    <param name="rtp-port-range" value="16384-32768"/>
    <!-- WebSocket transport on port 5066 (plain WS; TLS terminated by reverse proxy) -->
    <param name="ws-binding" value="0.0.0.0:5066"/>
    <param name="inbound-codec-prefs" value="opus,G722,PCMU,PCMA"/>
    <param name="outbound-codec-prefs" value="opus,G722,PCMU,PCMA"/>
    <param name="inbound-codec-negotiation" value="generous"/>
    <param name="stun-enabled" value="true"/>
    <param name="stun-auto-disable" value="false"/>
    <param name="auth-calls" value="true"/>
    <param name="inbound-reg-force-matching-username" value="true"/>
    <param name="aggressive-nat-detection" value="true"/>
    <param name="apply-nat-acl" value="nat.auto"/>
    <param name="dtmf-duration" value="2000"/>
    <param name="rfc2833-pt" value="101"/>
    <param name="session-timeout" value="1800"/>
    <param name="max-registrations-per-extension" value="5"/>
    <param name="sip-trace" value="no"/>
    <param name="debug" value="0"/>
  </settings>
  <gateways>${gwXml}
  </gateways>
</profile>`;
}

// ── Escape a string for safe inclusion in a shell heredoc ───────────────────
function shellEscape(str) {
  // Replace single-quotes with '\'' for safe embedding in single-quoted strings.
  // We use a heredoc with a delimiter that can't appear in XML.
  return str; // heredoc with XMLEOF delimiter handles this cleanly
}

// ── Main fix routine ─────────────────────────────────────────────────────────
async function main() {
  const rawKey = process.env.FREESWITCH_SSH_KEY ?? "";
  const domain = process.env.FREESWITCH_DOMAIN ?? "";
  const sshUser = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
  const sshPort = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
  const apiPort = process.env.PORT ?? "8080";
  const pstnGw  = (process.env.PSTN_GATEWAY_NAME ?? "").trim();

  if (!rawKey || rawKey.includes("YOUR_KEY_HERE")) { console.error("ERROR: FREESWITCH_SSH_KEY not set"); process.exit(1); }
  if (!domain || domain === "YOUR_VPS_PUBLIC_IP") { console.error("ERROR: FREESWITCH_DOMAIN not set"); process.exit(1); }

  const host = bareHost(domain);
  const fsIp = host; // bare public IP
  const privateKey = cleanPrivateKey(rawKey);

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║    PRaww+ FreeSWITCH Config Fix — ${new Date().toISOString().slice(0,19)} ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`Target: ${sshUser}@${host}:${sshPort}  FS domain: ${fsIp}`);
  console.log(`API port: ${apiPort}  PSTN gateway: ${pstnGw || "(none)"}\n`);

  let conn;
  try {
    conn = await sshConnect(host, sshUser, sshPort, privateKey);
    console.log("✓ SSH connected\n");
  } catch (e) {
    console.error(`✗ SSH connection failed: ${e.message}`);
    process.exit(1);
  }

  // Detect config dir
  const { out: confDir } = await execCommand(conn, "[ -d /etc/freeswitch ] && echo /etc/freeswitch || echo /usr/local/freeswitch/conf");
  const FS_CONF = confDir.trim();
  console.log(`✓ FreeSWITCH config dir: ${FS_CONF}\n`);

  // ── FIX 1: Deploy the "prawwplus" dialplan context ───────────────────────
  console.log("═══ FIX 1: Deploy prawwplus dialplan context ═══");
  const dialplan = dialplanXml(fsIp, apiPort, pstnGw);

  // Write dialplan via heredoc
  const writeDialplanCmd = `cat > ${FS_CONF}/dialplan/prawwplus.xml << 'XMLEOF'
${dialplan}
XMLEOF`;
  await run(conn, "Write prawwplus.xml dialplan", writeDialplanCmd);

  // Verify it was written
  await run(conn, "Verify dialplan file", `head -5 ${FS_CONF}/dialplan/prawwplus.xml && echo "... ($(wc -l < ${FS_CONF}/dialplan/prawwplus.xml) lines total)"`);

  // ── FIX 2: Deploy the prawwplus_mobile SIP profile ───────────────────────
  console.log("\n═══ FIX 2: Deploy prawwplus_mobile SIP profile ═══");
  const sipProfile = sipProfileXml(fsIp, pstnGw);
  const writeSipProfileCmd = `cat > ${FS_CONF}/sip_profiles/prawwplus_mobile.xml << 'XMLEOF'
${sipProfile}
XMLEOF`;
  await run(conn, "Write prawwplus_mobile.xml SIP profile", writeSipProfileCmd);
  await run(conn, "Verify SIP profile file", `head -5 ${FS_CONF}/sip_profiles/prawwplus_mobile.xml && echo "... ($(wc -l < ${FS_CONF}/sip_profiles/prawwplus_mobile.xml) lines total)"`);

  // Check if port 5066 is already in use by existing profile
  await run(conn, "Check port 5066 usage before reload", "ss -tlnp | grep 5066 || echo 'port 5066 not yet open'");
  await run(conn, "List sip_profiles dir", `ls -la ${FS_CONF}/sip_profiles/`);

  // ── FIX 3: Reload FreeSWITCH XML config ──────────────────────────────────
  console.log("\n═══ FIX 3: Reload FreeSWITCH XML config ═══");
  await run(conn, "Reload XML config", "fs_cli -x 'reloadxml' 2>/dev/null", 15000);

  // Start or rescan the new SIP profile
  await run(conn, "Start prawwplus_mobile SIP profile", "fs_cli -x 'sofia profile prawwplus_mobile start' 2>/dev/null || echo 'start attempted'", 15000);

  // Reload verto module to pick up any context changes
  await run(conn, "Reload verto config", "fs_cli -x 'verto reload' 2>/dev/null || echo 'verto reload attempted'", 15000);

  // Wait a moment for profiles to come up
  await new Promise(r => setTimeout(r, 3000));

  // ── FIX 4: ESL security — remove public port 8021 rule ───────────────────
  console.log("\n═══ FIX 4: Close ESL port 8021 from public internet ═══");
  // Remove the specific rule that allows all traffic to 8021
  await run(conn, "Remove iptables rule for public port 8021", "sudo iptables -D INPUT -p tcp --dport 8021 -j ACCEPT 2>/dev/null && echo 'Rule removed' || echo 'Rule not found or already removed'");
  // Ensure ESL is still accessible from localhost only (127.0.0.1)
  await run(conn, "Add localhost-only rule for ESL if missing",
    "sudo iptables -C INPUT -s 127.0.0.1 -p tcp --dport 8021 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -s 127.0.0.1 -p tcp --dport 8021 -j ACCEPT && echo 'Localhost ESL rule ensured'");
  // Save iptables rules so they persist after reboot
  await run(conn, "Save iptables rules", "sudo netfilter-persistent save 2>/dev/null || sudo iptables-save > /etc/iptables/rules.v4 2>/dev/null || echo 'iptables save attempted'");

  // ── VERIFY: Check everything came up correctly ────────────────────────────
  console.log("\n═══ VERIFICATION ═══");
  await run(conn, "Port 5066 (SIP WS) now listening", "ss -tlnp | grep 5066 || echo 'FAIL: port 5066 not open'");
  await run(conn, "Port 8081 (Verto WS) still listening", "ss -tlnp | grep 8081 || echo 'FAIL: port 8081 not open'");
  await run(conn, "ESL port 8021 only localhost", "ss -tlnp | grep 8021");
  await run(conn, "Sofia profiles status", "fs_cli -x 'sofia status' 2>/dev/null");
  await run(conn, "prawwplus_mobile profile status", "fs_cli -x 'sofia status profile prawwplus_mobile' 2>/dev/null || echo 'profile not yet loaded'");
  await run(conn, "Loaded dialplan contexts", "fs_cli -x 'xml_locate dialplan' 2>/dev/null | grep '<context' || echo 'check manually'");

  // ── TEST: Verify dialplan routing for an extension ───────────────────────
  console.log("\n═══ DIALPLAN ROUTE TEST ═══");
  await run(conn, "Test dialplan routing (ext 1000 in prawwplus context)",
    "fs_cli -x 'xml_locate dialplan XML prawwplus 1000' 2>/dev/null | head -20 || echo 'test failed'", 10000);

  // ── Recent logs check ─────────────────────────────────────────────────────
  console.log("\n═══ RECENT FREESWITCH LOGS (last 30 lines) ═══");
  await run(conn, "Recent FS logs", "tail -30 /var/log/freeswitch/freeswitch.log 2>/dev/null || journalctl -u freeswitch --no-pager -n 30 2>/dev/null || echo 'log not found'", 10000);

  conn.end();
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  Fix script completed successfully   ║");
  console.log("╚══════════════════════════════════════╝\n");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
