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
  const FS_VAR = "${";
  return `<include>
  <!--
    PRawwPlus Dialplan — domain: ${fsDomain}

    Context: "prawwplus" — completely isolated from FreeSWITCH's built-in
    "default" context. Both the Verto profile (port 8081) and the SIP/WS
    profile (port 5066) are configured to use this context, so calls ALWAYS
    land here and never hit the default FreeSWITCH extension handlers.

    Bridge strategy: "verto_contact/N@domain" finds web app (Verto WebRTC)
    registrations.  "user/N@domain" finds mobile (SIP/WS) registrations.
    The comma "," dials them SIMULTANEOUSLY — first to answer wins.

    Failure handling may route to voicemail (requires mod_voicemail).
    Every failure path plays a TTS announcement then hangs up with the correct
    SIP cause code so the caller's UI shows the right reason.
  -->
  <context name="prawwplus">

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
      hangup_after_bridge=false keeps the A-leg alive after the bridge ends
      so the subsequent conditions can play announcements.
      continue_on_fail=true ensures those conditions are evaluated.
    -->
    <extension name="internal_extensions" continue="true">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$" break="on-false">
        <action application="set" data="effective_caller_id_name=${FS_VAR}caller_id_name}"/>
        <action application="set" data="effective_caller_id_number=${FS_VAR}caller_id_number}"/>
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=false"/>
        <action application="set" data="continue_on_fail=true"/>
        <action application="set" data="forward_depth=${FS_VAR}default(${FS_VAR}forward_depth},0)"/>
        <action application="set" data="forward_target=${FS_VAR}user_data($1@${fsDomain} var callForwardAlwaysTo)}"/>
        <action application="set" data="forward_enabled=${FS_VAR}user_data($1@${fsDomain} var callForwardAlwaysEnabled)}"/>

        <!-- Always-forward happens before ringing the extension. -->
        <action application="set" data="should_forward=${FS_VAR}regex(${FS_VAR}forward_enabled}|^true$)}"/>
        <action application="set" data="should_forward=${FS_VAR}expr(${FS_VAR}should_forward} && ${FS_VAR}strlen(${FS_VAR}forward_target}) > 0 && ${FS_VAR}forward_depth} &lt; 3)}"/>
        <action application="set" data="should_forward=${FS_VAR}expr(${FS_VAR}should_forward} && '${FS_VAR}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${FS_VAR}expr(${FS_VAR}forward_depth}+1)"/>
        <action application="set" data="execute_forward=${FS_VAR}expr(${FS_VAR}should_forward})"/>

        <action application="set" data="forward_is_ext=${FS_VAR}regex(${FS_VAR}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${FS_VAR}regex(${FS_VAR}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${FS_VAR}regex(${FS_VAR}forward_target}|^\+?[1-9][0-9]{6,14}$)}"/>

        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_ext} == 1?verto_contact/${FS_VAR}forward_target}@${fsDomain},user/${FS_VAR}forward_target}@${fsDomain}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_sip} == 1?${FS_VAR}forward_target}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_num} == 1?loopback/${FS_VAR}forward_target}/${fsDomain}:"/>

        <!--
          Simultaneous ring: both Verto (web/WebRTC) and SIP/WS (mobile JsSIP)
          contacts for the extension are called at the same time.
          IMPORTANT: "user/" only finds SIP registrations (mod_sofia).
                     "verto_contact/" only finds Verto registrations (mod_verto).
          We need BOTH with "," (simultaneous) so web AND mobile clients ring.
          First to answer wins; the other leg is cleanly released.
        -->
        <action application="bridge" data="verto_contact/\$1@${fsDomain},user/\$1@${fsDomain}"/>
      </condition>

      <!-- Call forwarding on busy/no-answer/unavailable occurs after the initial bridge attempt. -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^USER_BUSY$" break="never">
        <action application="set" data="forward_depth=${FS_VAR}default(${FS_VAR}forward_depth},0)"/>
        <action application="set" data="forward_target=${FS_VAR}user_data($1@${fsDomain} var callForwardBusyTo)}"/>
        <action application="set" data="forward_enabled=${FS_VAR}user_data($1@${fsDomain} var callForwardBusyEnabled)}"/>
        <action application="set" data="execute_forward=${FS_VAR}expr(${FS_VAR}regex(${FS_VAR}forward_enabled}|^true$) &amp;&amp; ${FS_VAR}strlen(${FS_VAR}forward_target}) > 0 &amp;&amp; ${FS_VAR}forward_depth} &lt; 3 &amp;&amp; '${FS_VAR}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${FS_VAR}expr(${FS_VAR}forward_depth}+1)"/>
        <action application="set" data="forward_is_ext=${FS_VAR}regex(${FS_VAR}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${FS_VAR}regex(${FS_VAR}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${FS_VAR}regex(${FS_VAR}forward_target}|^\+?[1-9][0-9]{6,14}$)}"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_ext} == 1?verto_contact/${FS_VAR}forward_target}@${fsDomain},user/${FS_VAR}forward_target}@${fsDomain}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_sip} == 1?${FS_VAR}forward_target}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_num} == 1?loopback/${FS_VAR}forward_target}/${fsDomain}:"/>
      </condition>

      <!-- Callee is busy (cause 17)
           Busy tone: 480+620 Hz, 500ms on / 500ms off, 4 cycles (~4 s).
           tone_stream is always available regardless of mod_flite.
           speak is attempted after as a best-effort voice announcement.  -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^USER_BUSY$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(500,500,480,620);loops=4"/>
        <action application="speak" data="flite|kal|The number you are calling is currently busy. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="USER_BUSY"/>
      </condition>

      <!--
        Callee did not answer in time (cause 19).
        Order matters: forwarding and voicemail run first (break="never" so
        they always execute). The terminal announcement only fires last
        (break="on-true") — if we reach it, neither forwarding nor voicemail
        handled the call.
      -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(NO_ANSWER|RECOVERY_ON_TIMER_EXPIRE)$" break="never">
        <action application="set" data="forward_depth=${FS_VAR}default(${FS_VAR}forward_depth},0)}"/>
        <action application="set" data="forward_target=${FS_VAR}user_data($1@${fsDomain} var callForwardNoAnswerTo)}"/>
        <action application="set" data="forward_enabled=${FS_VAR}user_data($1@${fsDomain} var callForwardNoAnswerEnabled)}"/>
        <action application="set" data="execute_forward=${FS_VAR}expr(${FS_VAR}regex(${FS_VAR}forward_enabled}|^true$) &amp;&amp; ${FS_VAR}strlen(${FS_VAR}forward_target}) > 0 &amp;&amp; ${FS_VAR}forward_depth} &lt; 3 &amp;&amp; '${FS_VAR}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${FS_VAR}expr(${FS_VAR}forward_depth}+1)}"/>
        <action application="set" data="forward_is_ext=${FS_VAR}regex(${FS_VAR}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${FS_VAR}regex(${FS_VAR}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${FS_VAR}regex(${FS_VAR}forward_target}|^\+?[1-9][0-9]{6,14}$)}"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_ext} == 1?verto_contact/${FS_VAR}forward_target}@${fsDomain},user/${FS_VAR}forward_target}@${fsDomain}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_sip} == 1?${FS_VAR}forward_target}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_num} == 1?loopback/${FS_VAR}forward_target}/${fsDomain}:"/>
      </condition>

      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(NO_ANSWER|RECOVERY_ON_TIMER_EXPIRE)$" break="never">
        <action application="answer"/>
        <action application="voicemail" data="default ${fsDomain} $1"/>
        <action application="hangup" data="NORMAL_CLEARING"/>
      </condition>

      <!-- Reorder / fast-busy tone: 480+620 Hz, 250ms on / 250ms off, 6 cycles (~3 s).
           Only reached if neither forwarding nor voicemail handled the call. -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(NO_ANSWER|RECOVERY_ON_TIMER_EXPIRE)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(250,250,480,620);loops=6"/>
        <action application="speak" data="flite|kal|The person you are calling is not available. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="NO_ANSWER"/>
      </condition>

      <!-- Caller cancelled before answer — just hang up, no announcement needed -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(ORIGINATOR_CANCEL|NORMAL_CLEARING)$" break="on-true">
        <action application="hangup" data="${FS_VAR}bridge_hangup_cause}"/>
      </condition>

      <!--
        Callee offline / not registered (cause 20).
        Same ordering rule as NO_ANSWER: forwarding and voicemail first
        (break="never"), terminal SIT announcement last (break="on-true").
      -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(UNREGISTERED|USER_NOT_REGISTERED|SUBSCRIBER_ABSENT|DESTINATION_OUT_OF_ORDER)$" break="never">
        <action application="set" data="forward_depth=${FS_VAR}default(${FS_VAR}forward_depth},0)}"/>
        <action application="set" data="forward_target=${FS_VAR}user_data($1@${fsDomain} var callForwardUnavailableTo)}"/>
        <action application="set" data="forward_enabled=${FS_VAR}user_data($1@${fsDomain} var callForwardUnavailableEnabled)}"/>
        <action application="set" data="execute_forward=${FS_VAR}expr(${FS_VAR}regex(${FS_VAR}forward_enabled}|^true$) &amp;&amp; ${FS_VAR}strlen(${FS_VAR}forward_target}) > 0 &amp;&amp; ${FS_VAR}forward_depth} &lt; 3 &amp;&amp; '${FS_VAR}forward_target}' != '$1')}"/>
        <action application="set" data="forward_depth=${FS_VAR}expr(${FS_VAR}forward_depth}+1)}"/>
        <action application="set" data="forward_is_ext=${FS_VAR}regex(${FS_VAR}forward_target}|^([1-9][0-9]{3})$)}"/>
        <action application="set" data="forward_is_sip=${FS_VAR}regex(${FS_VAR}forward_target}|^sip:)}"/>
        <action application="set" data="forward_is_num=${FS_VAR}regex(${FS_VAR}forward_target}|^\+?[1-9][0-9]{6,14}$)}"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_ext} == 1?verto_contact/${FS_VAR}forward_target}@${fsDomain},user/${FS_VAR}forward_target}@${fsDomain}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_sip} == 1?${FS_VAR}forward_target}:"/>
        <action application="bridge" data="${FS_VAR}if(${FS_VAR}execute_forward} == 1 &amp;&amp; ${FS_VAR}forward_is_num} == 1?loopback/${FS_VAR}forward_target}/${fsDomain}:"/>
      </condition>

      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(UNREGISTERED|USER_NOT_REGISTERED|SUBSCRIBER_ABSENT|DESTINATION_OUT_OF_ORDER)$" break="never">
        <action application="answer"/>
        <action application="voicemail" data="default ${fsDomain} $1"/>
        <action application="hangup" data="NORMAL_CLEARING"/>
      </condition>

      <!-- SIT tone (Special Information Tone): 913→1370→1776 Hz, 274ms each, 2 repeats.
           Only reached if neither forwarding nor voicemail handled the call. -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(UNREGISTERED|USER_NOT_REGISTERED|SUBSCRIBER_ABSENT|DESTINATION_OUT_OF_ORDER)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=2"/>
        <action application="speak" data="flite|kal|The number you have dialed is currently unavailable. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="UNREGISTERED"/>
      </condition>

      <!-- Unknown destination
           SIT tone followed by announcement. -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(NO_ROUTE_DESTINATION|UNALLOCATED_NUMBER)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=2"/>
        <action application="speak" data="flite|kal|The number you have dialed does not exist. Please check the number and try again."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="NO_ROUTE_DESTINATION"/>
      </condition>

      <!-- Catch-all for any other bridge failure -->
      <condition field="${FS_VAR}bridge_hangup_cause}" expression="^(.+)$" break="on-true">
        <action application="answer"/>
        <action application="playback" data="tone_stream://%(274,0,913.8);%(274,0,1370.6);%(380,0,1776.7);loops=2"/>
        <action application="speak" data="flite|kal|The call could not be completed. Please try again later."/>
        <action application="sleep" data="300"/>
        <action application="hangup" data="${FS_VAR}bridge_hangup_cause}"/>
      </condition>
    </extension>

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
  <gateways/>
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
