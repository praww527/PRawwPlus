/**
 * FreeSWITCH XML configuration generators.
 *
 * Produces the XML files that need to live on the FreeSWITCH server so it can:
 *  1. Authenticate users via mod_xml_curl → our /api/freeswitch/directory endpoint
 *  2. Route internal extension-to-extension calls via mod_verto
 *  3. Accept WebRTC connections from browsers via mod_verto on port 8081 (plain WS)
 *  4. Route unanswered calls to voicemail after ring timeout
 *  5. Reject invalid destinations with appropriate messages
 *
 * Call tracking is handled entirely by the ESL listener (freeswitchESL.ts) which
 * receives CHANNEL_ANSWER and CHANNEL_HANGUP_COMPLETE events directly from FreeSWITCH.
 */

export function xmlCurlConf(appUrl: string): string {
  const directoryUrl = `${appUrl}/api/freeswitch/directory`;
  return `<configuration name="xml_curl.conf" description="XML Curl">
  <bindings>
    <binding name="directory">
      <param name="gateway-url" value="${directoryUrl}" bindings="directory"/>
      <param name="timeout" value="5"/>
      <param name="disable-100-continue" value="true"/>
    </binding>
  </bindings>
</configuration>`;
}

export function voicemailConf(): string {
  // Keep this minimal; mailbox auth is handled via directory params/variables.
  // Storage is under FreeSWITCH's standard storage root.
  const FS_VAR = "${";
  return `<configuration name="voicemail.conf" description="Voicemail">
  <settings>
    <param name="storage-dir" value="$${FS_VAR}recordings_dir}/voicemail"/>
  </settings>
  <profiles>
    <profile name="default">
      <param name="db-password-override" value=""/>
      <param name="auto-playback-recordings" value="true"/>
    </profile>
  </profiles>
</configuration>`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pstnGatewayName(): string {
  return (process.env.PSTN_GATEWAY_NAME ?? "").trim();
}

function pstnGatewayXml(): string {
  const name = pstnGatewayName();
  const username = (process.env.PSTN_GATEWAY_USERNAME ?? "").trim();
  const password = process.env.PSTN_GATEWAY_PASSWORD ?? "";
  const proxy = (process.env.PSTN_GATEWAY_PROXY ?? "").trim();
  const realm = (process.env.PSTN_GATEWAY_REALM ?? proxy).trim();
  const fromDomain = (process.env.PSTN_GATEWAY_FROM_DOMAIN ?? realm).trim();
  const register = (process.env.PSTN_GATEWAY_REGISTER ?? "true").trim();

  if (!name || !username || !password || !proxy) return "";

  return `
    <gateway name="${xmlEscape(name)}">
      <param name="username" value="${xmlEscape(username)}"/>
      <param name="password" value="${xmlEscape(password)}"/>
      <param name="proxy" value="${xmlEscape(proxy)}"/>
      <param name="realm" value="${xmlEscape(realm)}"/>
      <param name="from-domain" value="${xmlEscape(fromDomain)}"/>
      <param name="register" value="${xmlEscape(register)}"/>
      <param name="expire-seconds" value="300"/>
      <param name="retry-seconds" value="30"/>
    </gateway>
  `;
}

export function vertoConf(fsIp: string): string {
  return `<configuration name="verto.conf" description="Verto Endpoint">
  <settings>
    <param name="debug" value="0"/>
    <param name="ksys-uuid" value="false"/>
  </settings>
  <profiles>
    <!--
      Plain WebSocket on port 8081 (no TLS).
      TLS is terminated by the reverse proxy in front of the API server —
      browsers connect via wss://rtc.PRaww.co.za/api/verto/ws and the proxy
      forwards to ws://fs:8081.
    -->
    <profile name="default-v4">
      <param name="bind-local" value="0.0.0.0:8081"/>

      <!--
        RTP bind address: 0.0.0.0 ensures FreeSWITCH binds its RTP sockets on
        ALL local interfaces. Required on cloud VMs with both a private NIC
        (10.x.x.x) and a public NIC/alias (${fsIp}).
      -->
      <param name="rtp-ip" value="0.0.0.0"/>

      <!--
        NAT: Explicit public IP so FreeSWITCH advertises the correct address
        in ICE candidates and SDP. Prevents one-way / no-audio issues.
      -->
      <param name="ext-rtp-ip" value="${fsIp}"/>
      <param name="ext-sip-ip" value="${fsIp}"/>

      <!--
        STUN: Used to validate/refresh the external IP.
        stun-auto-disable=false prevents fallback to private IP on STUN failure.
      -->
      <param name="stun-ip" value="stun.l.google.com"/>
      <param name="stun-port" value="19302"/>
      <param name="stun-enabled" value="true"/>
      <param name="stun-auto-disable" value="false"/>

      <param name="local-network" value="localnet.auto"/>
      <param name="apply-candidate-acl" value="any_v4.auto"/>

      <param name="dialplan" value="XML"/>
      <!--
        Use the dedicated "prawwplus" context so calls are routed by OUR
        dialplan only, completely isolated from the default FreeSWITCH dialplan
        (which has its own 4-digit extension handlers that would match first).
      -->
      <param name="context" value="prawwplus"/>

      <!--
        Codecs: Opus first (WebRTC / browser / mobile), G722 for HD voice on
        SIP endpoints, then PCMU/PCMA for PSTN gateway interoperability.
        mod_opus MUST be installed: sudo apt-get install freeswitch-mod-opus
      -->
      <param name="outbound-codec-string" value="opus,G722,PCMU,PCMA"/>
      <param name="inbound-codec-string" value="opus,G722,PCMU,PCMA"/>

      <!--
        RTP timeouts: disconnect if no RTP arrives within 30s (dead call cleanup).
        Hold allows 2 minutes of silence before hanging up.
      -->
      <param name="rtp-timeout-sec" value="30"/>
      <param name="rtp-hold-timeout-sec" value="120"/>

      <!--
        Timer: "soft" avoids dependency on kernel HRT timers which may not be
        available in virtualised/cloud environments (Oracle VM).
      -->
      <param name="timer-name" value="soft"/>
    </profile>
  </profiles>
</configuration>`;
}

export function dialplanXml(fsDomain: string): string {
  // FS_VAR is used to produce literal "${" in the generated XML so FreeSWITCH
  // evaluates channel/global variables at call-time rather than at generation-time.
  const FS_VAR = "${";
  const gateway = pstnGatewayName();
  const externalRoute = gateway
    ? `
    <extension name="external_pstn_numbers" continue="false">
      <condition field="destination_number" expression="^(\\+?[0-9]{7,15})$">
        <action application="set" data="effective_caller_id_name=${FS_VAR}caller_id_name}"/>
        <action application="set" data="effective_caller_id_number=${FS_VAR}caller_id_number}"/>
        <action application="set" data="outbound_caller_id_name=${FS_VAR}caller_id_name}"/>
        <action application="set" data="outbound_caller_id_number=${FS_VAR}caller_id_number}"/>
        <action application="set" data="call_timeout=45"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="set" data="continue_on_fail=false"/>
        <!-- Billing notice: caller hears this before the PSTN call is bridged -->
        <action application="answer"/>
        <action application="speak" data="flite|kal|Please note. You are calling a number outside the PRaww app. This call will be billed to your account."/>
        <action application="sleep" data="500"/>
        <action application="bridge" data="sofia/gateway/${xmlEscape(gateway)}/$1"/>
      </condition>
    </extension>
`
    : `
    <extension name="external_pstn_not_configured" continue="false">
      <condition field="destination_number" expression="^(\\+?[0-9]{7,15})$">
        <action application="log" data="ERR External PSTN call rejected because PSTN_GATEWAY_NAME is not configured"/>
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

    Context: "prawwplus" — completely isolated from FreeSWITCH's built-in
    "default" context. Both the Verto profile (port 8081) and the SIP/WS
    profile (port 5066) are configured to use this context, so calls ALWAYS
    land here and never hit the default FreeSWITCH extension handlers.

    Bridge strategy:
      "verto_contact/N@domain" — WebRTC / Verto registrations (mod_verto).
      "user/N@domain"          — SIP/WS registrations (mod_sofia).
      Comma ","                — dials both SIMULTANEOUSLY; first to answer wins.

    KEY DESIGN NOTE — _orig_bridge_cause
    ──────────────────────────────────────
    The forwarding blocks that fire after the main bridge may themselves call
    bridge with an empty string when no forward is configured (the
    "${FS_VAR}if(cond?target:)}" pattern resolves to "" when the condition is
    false).  Those empty bridge attempts overwrite bridge_hangup_cause with
    UNALLOCATED_NUMBER, masking the real cause (NO_ANSWER / USER_BUSY /
    UNREGISTERED).

    Fix: we save bridge_hangup_cause into _orig_bridge_cause immediately after
    the main bridge returns, and use _orig_bridge_cause in every subsequent
    condition check.  This means forwarding-block bridge failures cannot
    corrupt the original failure reason.
  -->
  <context name="prawwplus">

    <!-- ── DND check (runs first; continue="true" falls through) ────── -->
    <extension name="dnd_reject" continue="true">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$" break="never">
        <action application="set" data="callee_dnd=${FS_VAR}user_data($1@${fsDomain} var dnd)}"/>
      </condition>
      <condition field="${FS_VAR}callee_dnd}" expression="^true$" break="on-true">
        <action application="answer"/>
        <action application="speak" data="flite|kal|The person you are calling is not available."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="CALL_REJECTED"/>
      </condition>
    </extension>

    <!--
      Internal extension-to-extension calls (1000–9999).

      hangup_after_bridge=false — keeps the A-leg alive after any bridge ends
        so the subsequent conditions can play announcements / route to voicemail.
      continue_on_fail=true — ensures those conditions are evaluated even when
        the bridge fails (no-answer, busy, unregistered, etc.).
    -->
    <extension name="internal_extensions" continue="true">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$" break="on-false">
        <action application="set" data="effective_caller_id_name=${FS_VAR}caller_id_name}"/>
        <action application="set" data="effective_caller_id_number=${FS_VAR}caller_id_number}"/>
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=false"/>
        <action application="set" data="continue_on_fail=true"/>
        <action application="set" data="forward_depth=${FS_VAR}default(${FS_VAR}forward_depth},0)}"/>

        <!--
          Ringback tone — caller hears a real ring tone while the callee device
          is alerting.  Without this the caller hears silence.
          ${FS_VAR}us-ring} is a built-in FreeSWITCH tone (440+480 Hz, 2s/4s cadence).
        -->
        <action application="set" data="ringback=${FS_VAR}us-ring}"/>
        <action application="set" data="transfer_ringback=${FS_VAR}us-ring}"/>

        <!--
          Call recording — start immediately so the full call (including any
          forwarded leg) is captured in a single WAV file.
          FreeSWITCH creates the calls/ subdirectory automatically if absent.
          Filename: call_<from>_<to>_<uuid>.wav
          Path:     $${FS_VAR}recordings_dir}/calls/  (global var from vars.xml)
        -->
        <action application="set" data="RECORD_STEREO=true"/>
        <action application="record_session" data="$${FS_VAR}recordings_dir}/calls/call_${FS_VAR}caller_id_number}_${FS_VAR}destination_number}_${FS_VAR}unique_id}.wav"/>

        <!-- ── Always-forward: evaluated before ringing the target extension. ── -->
        <action application="set" data="forward_target=${FS_VAR}user_data($1@${fsDomain} var callForwardAlwaysTo)}"/>
        <action application="set" data="forward_enabled=${FS_VAR}user_data($1@${fsDomain} var callForwardAlwaysEnabled)}"/>
        <action application="set" data="should_forward=${FS_VAR}regex(${FS_VAR}forward_enabled}|^true$)}"/>
        <action application="set" data="should_forward=${FS_VAR}expr(${FS_VAR}should_forward} &amp;&amp; ${FS_VAR}strlen(${FS_VAR}forward_target}) &gt; 0 &amp;&amp; ${FS_VAR}forward_depth} &lt; 3)}"/>
        <action application="set" data="should_forward=${FS_VAR}expr(${FS_VAR}should_forward} &amp;&amp; '${FS_VAR}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${FS_VAR}expr(${FS_VAR}forward_depth}+1)"/>
        <action application="set" data="execute_forward=${FS_VAR}expr(${FS_VAR}should_forward})"/>
        <action application="set" data="forward_is_ext=${FS_VAR}regex(${FS_VAR}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${FS_VAR}regex(${FS_VAR}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${FS_VAR}regex(${FS_VAR}forward_target}|^\+?[1-9][0-9]{6,14}$)}"/>

        <!--
          When execute_forward == 0 the ${FS_VAR}if(...?target:)} resolves to an
          empty string and bridge fails instantly (no blocking delay).
        -->
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_ext} == 1?verto_contact/${FS_VAR}forward_target}@${fsDomain},user/${FS_VAR}forward_target}@${fsDomain}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_sip} == 1?${FS_VAR}forward_target}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_num} == 1?loopback/${FS_VAR}forward_target}/${fsDomain}:"/>

        <!--
          Main bridge: ring both Verto (web/WebRTC) and SIP/WS (mobile) contacts
          for the extension simultaneously.  First to answer wins; the other leg
          is cleanly released.
        -->
        <action application="bridge" data="verto_contact/\$1@${fsDomain},user/\$1@${fsDomain}"/>

        <!--
          CRITICAL — save bridge_hangup_cause immediately after the main bridge.
          The forwarding blocks below attempt their own bridge calls (with empty
          strings when not configured) which would overwrite bridge_hangup_cause.
          All subsequent condition checks use _orig_bridge_cause so the real
          failure reason (NO_ANSWER / USER_BUSY / UNREGISTERED) is preserved.
        -->
        <action application="set" data="_orig_bridge_cause=${FS_VAR}bridge_hangup_cause}"/>
      </condition>

      <!-- ── Busy forwarding ──────────────────────────────────────────────────
           break="never" so execution always falls through to the terminal
           busy condition below even when no forward is configured.           -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^USER_BUSY$" break="never">
        <action application="set" data="forward_depth=${FS_VAR}default(${FS_VAR}forward_depth},0)}"/>
        <action application="set" data="forward_target=${FS_VAR}user_data($1@${fsDomain} var callForwardBusyTo)}"/>
        <action application="set" data="forward_enabled=${FS_VAR}user_data($1@${fsDomain} var callForwardBusyEnabled)}"/>
        <action application="set" data="execute_forward=${FS_VAR}expr(${FS_VAR}regex(${FS_VAR}forward_enabled}|^true$) &amp;&amp; ${FS_VAR}strlen(${FS_VAR}forward_target}) &gt; 0 &amp;&amp; ${FS_VAR}forward_depth} &lt; 3 &amp;&amp; '${FS_VAR}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${FS_VAR}expr(${FS_VAR}forward_depth}+1)"/>
        <action application="set" data="forward_is_ext=${FS_VAR}regex(${FS_VAR}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${FS_VAR}regex(${FS_VAR}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${FS_VAR}regex(${FS_VAR}forward_target}|^\+?[1-9][0-9]{6,14}$)}"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_ext} == 1?verto_contact/${FS_VAR}forward_target}@${fsDomain},user/${FS_VAR}forward_target}@${fsDomain}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_sip} == 1?${FS_VAR}forward_target}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_num} == 1?loopback/${FS_VAR}forward_target}/${fsDomain}:"/>
      </condition>

      <!-- Callee is busy (cause 17).
           Busy tone: 480+620 Hz, 500 ms on / 500 ms off, 4 cycles (~4 s).
           tone_stream is available regardless of mod_flite.                  -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^USER_BUSY$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(500,500,480,620);loops=4"/>
        <action application="speak" data="flite|kal|The number you are calling is currently busy. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="USER_BUSY"/>
      </condition>

      <!-- ── No-answer forwarding ─────────────────────────────────────────────
           break="never" so execution falls through to voicemail below when no
           forward is configured or when the forward itself also fails.        -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^(NO_ANSWER|RECOVERY_ON_TIMER_EXPIRE)$" break="never">
        <action application="set" data="forward_depth=${FS_VAR}default(${FS_VAR}forward_depth},0)}"/>
        <action application="set" data="forward_target=${FS_VAR}user_data($1@${fsDomain} var callForwardNoAnswerTo)}"/>
        <action application="set" data="forward_enabled=${FS_VAR}user_data($1@${fsDomain} var callForwardNoAnswerEnabled)}"/>
        <action application="set" data="execute_forward=${FS_VAR}expr(${FS_VAR}regex(${FS_VAR}forward_enabled}|^true$) &amp;&amp; ${FS_VAR}strlen(${FS_VAR}forward_target}) &gt; 0 &amp;&amp; ${FS_VAR}forward_depth} &lt; 3 &amp;&amp; '${FS_VAR}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${FS_VAR}expr(${FS_VAR}forward_depth}+1)}"/>
        <action application="set" data="forward_is_ext=${FS_VAR}regex(${FS_VAR}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${FS_VAR}regex(${FS_VAR}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${FS_VAR}regex(${FS_VAR}forward_target}|^\+?[1-9][0-9]{6,14}$)}"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_ext} == 1?verto_contact/${FS_VAR}forward_target}@${fsDomain},user/${FS_VAR}forward_target}@${fsDomain}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_sip} == 1?${FS_VAR}forward_target}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_num} == 1?loopback/${FS_VAR}forward_target}/${fsDomain}:"/>
      </condition>

      <!-- NO_ANSWER terminal: voicemail plays greeting then records message.
           ATTENDED_TRANSFER hangup cause → caller UI shows "Went to voicemail". -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^(NO_ANSWER|RECOVERY_ON_TIMER_EXPIRE)$" break="on-true">
        <action application="answer"/>
        <action application="voicemail" data="default ${fsDomain} $1"/>
        <action application="hangup" data="ATTENDED_TRANSFER"/>
      </condition>

      <!-- Caller cancelled before answer — hang up cleanly, no announcement. -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^(ORIGINATOR_CANCEL|NORMAL_CLEARING)$" break="on-true">
        <action application="hangup" data="${FS_VAR}_orig_bridge_cause}"/>
      </condition>

      <!-- ── Unavailable forwarding ──────────────────────────────────────────
           Callee offline / not registered (cause 20).
           Try call-forward-unavailable first; then play SIT tone.           -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^(UNREGISTERED|USER_NOT_REGISTERED|SUBSCRIBER_ABSENT|DESTINATION_OUT_OF_ORDER)$" break="never">
        <action application="set" data="forward_depth=${FS_VAR}default(${FS_VAR}forward_depth},0)}"/>
        <action application="set" data="forward_target=${FS_VAR}user_data($1@${fsDomain} var callForwardUnavailableTo)}"/>
        <action application="set" data="forward_enabled=${FS_VAR}user_data($1@${fsDomain} var callForwardUnavailableEnabled)}"/>
        <action application="set" data="execute_forward=${FS_VAR}expr(${FS_VAR}regex(${FS_VAR}forward_enabled}|^true$) &amp;&amp; ${FS_VAR}strlen(${FS_VAR}forward_target}) &gt; 0 &amp;&amp; ${FS_VAR}forward_depth} &lt; 3 &amp;&amp; '${FS_VAR}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${FS_VAR}expr(${FS_VAR}forward_depth}+1)}"/>
        <action application="set" data="forward_is_ext=${FS_VAR}regex(${FS_VAR}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${FS_VAR}regex(${FS_VAR}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${FS_VAR}regex(${FS_VAR}forward_target}|^\+?[1-9][0-9]{6,14}$)}"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_ext} == 1?verto_contact/${FS_VAR}forward_target}@${fsDomain},user/${FS_VAR}forward_target}@${fsDomain}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_sip} == 1?${FS_VAR}forward_target}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_num} == 1?loopback/${FS_VAR}forward_target}/${fsDomain}:"/>
      </condition>

      <!-- UNREGISTERED terminal: SIT tone (913→1370→1776 Hz) + announcement.  -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^(UNREGISTERED|USER_NOT_REGISTERED|SUBSCRIBER_ABSENT|DESTINATION_OUT_OF_ORDER)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=3"/>
        <action application="speak" data="flite|kal|The number you have dialed is currently unavailable. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="UNREGISTERED"/>
      </condition>

      <!-- Unknown / unroutable destination: SIT tone + voice.                 -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^(NO_ROUTE_DESTINATION|UNALLOCATED_NUMBER)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=2"/>
        <action application="speak" data="flite|kal|The number you have dialed does not exist. Please check the number and try again."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="NO_ROUTE_DESTINATION"/>
      </condition>

      <!-- Catch-all for any other bridge failure.                              -->
      <condition field="${FS_VAR}_orig_bridge_cause}" expression="^(.+)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=2"/>
        <action application="speak" data="flite|kal|The call could not be completed. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="${FS_VAR}_orig_bridge_cause}"/>
      </condition>
    </extension>

${externalRoute}

    <!--
      Invalid / unallocated numbers: any destination not matching 1000–9999.
      SIT tone + voice for maximum clarity.
    -->
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

/**
 * Sofia SIP profile with WebSocket transport (mod_sofia).
 * Mobile clients connect via wss://APP_URL/api/sip/ws → ws://fs:5066
 * This profile is written to sip_profiles/prawwplus_mobile.xml
 *
 * Port notes:
 *  - SIP-over-TCP/UDP uses port 5068 (non-standard) to avoid clashing with
 *    FreeSWITCH's built-in "internal" profile (5060) and "external" (5080).
 *  - WebSocket transport uses port 5066 (ws-binding) — the API SIP proxy
 *    forwards wss://APP/api/sip/ws → ws://FS:5066.
 */
export function sipProfileXml(fsIp: string, _appUrl: string): string {
  const gatewayXml = pstnGatewayXml();
  return `<profile name="prawwplus_mobile">
  <settings>
    <!--
      Use the dedicated "prawwplus" context — same as the Verto profile —
      so SIP/WS mobile clients are routed by our dialplan, not the default one.
    -->
    <param name="context" value="prawwplus"/>
    <param name="dialplan" value="XML"/>

    <!-- Bind SIP to a non-standard port to avoid conflicts with internal/external profiles -->
    <param name="sip-ip" value="${fsIp}"/>
    <param name="ext-sip-ip" value="${fsIp}"/>
    <param name="sip-port" value="5068"/>

    <!-- RTP -->
    <param name="rtp-ip" value="0.0.0.0"/>
    <param name="ext-rtp-ip" value="${fsIp}"/>
    <param name="rtp-port-range" value="16384-32768"/>

    <!-- WebSocket transport on port 5066 (plain WS; TLS terminated by proxy) -->
    <param name="ws-binding" value="0.0.0.0:5066"/>

    <!-- Codecs — Opus first (WebRTC), G722 (HD SIP), PCMU/PCMA (PSTN fallback) -->
    <param name="inbound-codec-prefs" value="opus,G722,PCMU,PCMA"/>
    <param name="outbound-codec-prefs" value="opus,G722,PCMU,PCMA"/>
    <param name="inbound-codec-negotiation" value="generous"/>

    <!-- STUN -->
    <param name="stun-enabled" value="true"/>
    <param name="stun-auto-disable" value="false"/>

    <!-- Authentication via mod_xml_curl directory -->
    <param name="auth-calls" value="true"/>
    <param name="inbound-reg-force-matching-username" value="true"/>

    <!-- NAT traversal -->
    <param name="aggressive-nat-detection" value="true"/>
    <param name="apply-nat-acl" value="nat.auto"/>

    <!-- DTMF RFC 2833 -->
    <param name="dtmf-duration" value="2000"/>
    <param name="rfc2833-pt" value="101"/>

    <!-- Session timers / registration -->
    <param name="session-timeout" value="1800"/>
    <param name="max-registrations-per-extension" value="5"/>

    <!-- Logging -->
    <param name="sip-trace" value="no"/>
    <param name="debug" value="0"/>
  </settings>
  <gateways>${gatewayXml}
  </gateways>
</profile>`;
}

export function eventSocketConf(password?: string): string {
  const eslPassword = password ?? process.env.FREESWITCH_ESL_PASSWORD ?? "ClueCon";
  return `<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="nat-map" value="false"/>
    <!--
      Security: bind ESL only to localhost. The API server connects from 127.0.0.1.
      Never expose port 8021 to the internet — use a firewall rule to block it externally.
    -->
    <param name="listen-ip" value="127.0.0.1"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="${eslPassword}"/>
  </settings>
</configuration>`;
}
