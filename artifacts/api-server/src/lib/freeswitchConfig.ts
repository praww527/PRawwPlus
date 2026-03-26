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
      <param name="context" value="default"/>

      <!--
        Codecs: Opus first for WebRTC browser compatibility, then PCMU/PCMA
        as fallback for PSTN/SIP trunks.
      -->
      <param name="outbound-codec-string" value="opus,PCMU,PCMA"/>
      <param name="inbound-codec-string" value="opus,PCMU,PCMA"/>

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
  return `<include>
  <!-- PRawwPlus Dialplan — domain: ${fsDomain} -->
  <context name="default">

    <!--
      Internal extension-to-extension calls (1000–9999).

      Flow after a failed bridge:
        USER_BUSY                            → busy signal  → hang up USER_BUSY
        NO_ANSWER / NORMAL_CLEARING          → voicemail    → hang up NO_ANSWER
        UNREGISTERED / USER_NOT_REGISTERED   → unavailable  → hang up UNREGISTERED
        anything else                        → unavailable  → preserve bridge cause

      The final hangup cause is forwarded to the browser in the verto.bye
      message so the UI can show the correct reason to the caller.
    -->
    <extension name="internal_extensions" continue="true">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$" break="on-false">
        <action application="set" data="effective_caller_id_name=\${caller_id_name}"/>
        <action application="set" data="effective_caller_id_number=\${caller_id_number}"/>
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=false"/>
        <action application="set" data="ringback=\${us-ring}"/>
        <action application="set" data="continue_on_fail=true"/>
        <!-- Try Verto first (web/desktop clients), then SIP (mobile JsSIP clients) -->
        <action application="bridge" data="verto_contact/\$1@${fsDomain}|sofia/call_manager_ws/\$1@${fsDomain}"/>
      </condition>

      <!--
        Callee is busy on another call.
        Voice: "The number you are calling is currently busy. Please try again later."
        Cause code 17 (USER_BUSY).
      -->
      <condition field="\${bridge_hangup_cause}" expression="^USER_BUSY$" break="on-true">
        <action application="answer"/>
        <action application="sleep" data="500"/>
        <action application="speak" data="flite|kal|The number you are calling is currently busy. Please try again later."/>
        <action application="sleep" data="1000"/>
        <action application="hangup" data="USER_BUSY"/>
      </condition>

      <!--
        Callee did not answer within ring timeout → send to voicemail.
        If mod_voicemail is not loaded or the extension has no mailbox,
        FreeSWITCH will hang up with NO_ANSWER automatically.
        Cause code 19 (NO_ANSWER).
      -->
      <condition field="\${bridge_hangup_cause}" expression="^(NO_ANSWER|NORMAL_CLEARING)$" break="on-true">
        <action application="answer"/>
        <action application="sleep" data="500"/>
        <action application="voicemail" data="default ${fsDomain} \$1"/>
        <anti-action application="speak" data="flite|kal|The person you are calling is not available. Please try again later."/>
        <anti-action application="sleep" data="1000"/>
        <anti-action application="hangup" data="NO_ANSWER"/>
      </condition>

      <!--
        Callee is not registered (not logged in / offline).
        Voice: "The number you have dialed is currently unavailable."
        Cause code 20 (SUBSCRIBER_ABSENT / maps to UNREGISTERED on A-leg).
      -->
      <condition field="\${bridge_hangup_cause}" expression="^(UNREGISTERED|USER_NOT_REGISTERED|SUBSCRIBER_ABSENT|NO_ROUTE_DESTINATION|DESTINATION_OUT_OF_ORDER)$" break="on-true">
        <action application="answer"/>
        <action application="sleep" data="500"/>
        <action application="speak" data="flite|kal|The number you have dialed is currently unavailable. Please try again later."/>
        <action application="sleep" data="1000"/>
        <action application="hangup" data="UNREGISTERED"/>
      </condition>

      <!--
        Call was cancelled by caller before it was answered (ORIGINATOR_CANCEL).
        No announcement needed — the caller already hung up.
      -->
      <condition field="\${bridge_hangup_cause}" expression="^ORIGINATOR_CANCEL$" break="on-true">
        <action application="hangup" data="ORIGINATOR_CANCEL"/>
      </condition>

      <!--
        Fallback for any other bridge failure — voice announcement then preserve cause.
      -->
      <condition field="\${bridge_hangup_cause}" expression="^(.+)$" break="on-true">
        <action application="answer"/>
        <action application="sleep" data="500"/>
        <action application="speak" data="flite|kal|The call could not be completed. Please try again later."/>
        <action application="sleep" data="1000"/>
        <action application="hangup" data="\${bridge_hangup_cause}"/>
      </condition>
    </extension>

    <!--
      Voicemail direct access.
        *97        — check your own voicemail
        *98<ext>   — check another extension's voicemail
    -->
    <extension name="voicemail_self">
      <condition field="destination_number" expression="^\*97$">
        <action application="answer"/>
        <action application="voicemail" data="check default ${fsDomain} \${caller_id_number}"/>
      </condition>
    </extension>

    <extension name="voicemail_other">
      <condition field="destination_number" expression="^\*98([1-9][0-9]{3})$">
        <action application="answer"/>
        <action application="voicemail" data="check default ${fsDomain} \$1"/>
      </condition>
    </extension>

    <!--
      Invalid / unallocated numbers: any destination not matching 1000–9999 or
      the voicemail codes above — answer, play voice announcement, hang up.
    -->
    <extension name="invalid_number">
      <condition field="destination_number" expression="^(.*)$">
        <action application="log" data="WARNING Rejected unmatched destination: \$1"/>
        <action application="answer"/>
        <action application="sleep" data="500"/>
        <action application="speak" data="flite|kal|The number you have dialed does not exist. Please check the number and try again."/>
        <action application="sleep" data="1000"/>
        <action application="hangup" data="NO_ROUTE_DESTINATION"/>
      </condition>
    </extension>

  </context>
</include>`;
}

/**
 * Sofia SIP profile with WebSocket transport (mod_sofia).
 * Mobile clients connect via wss://APP_URL/api/sip/ws → ws://fs:5066
 * This profile is written to sip_profiles/call_manager_ws.xml
 */
export function sipProfileXml(fsIp: string, appUrl: string): string {
  return `<profile name="call_manager_ws">
  <settings>
    <param name="context" value="default"/>
    <param name="dialplan" value="XML"/>
    <param name="sip-ip" value="${fsIp}"/>
    <param name="ext-sip-ip" value="${fsIp}"/>
    <param name="rtp-ip" value="0.0.0.0"/>
    <param name="ext-rtp-ip" value="${fsIp}"/>

    <!-- WebSocket transport on port 5066 (plain WS; TLS terminated by reverse proxy) -->
    <param name="ws-binding" value="0.0.0.0:5066"/>

    <!-- RTP port range -->
    <param name="rtp-port-range" value="16384-32768"/>

    <!-- Codecs — Opus first for WebRTC -->
    <param name="inbound-codec-prefs" value="opus,PCMU,PCMA,G722"/>
    <param name="outbound-codec-prefs" value="opus,PCMU,PCMA,G722"/>

    <!-- STUN -->
    <param name="stun-enabled" value="true"/>
    <param name="stun-auto-disable" value="false"/>

    <!-- Authentication via mod_xml_curl directory -->
    <param name="auth-calls" value="true"/>
    <param name="inbound-reg-force-matching-username" value="true"/>

    <!-- Session timers -->
    <param name="session-timeout" value="1800"/>

    <!-- NAT traversal -->
    <param name="aggressive-nat-detection" value="true"/>
    <param name="apply-nat-acl" value="nat.auto"/>

    <!-- DTMF -->
    <param name="dtmf-duration" value="2000"/>
    <param name="rfc2833-pt" value="101"/>

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
    <param name="listen-ip" value="0.0.0.0"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="${eslPassword}"/>
    <param name="apply-inbound-acl" value="any_v4.auto"/>
  </settings>
</configuration>`;
}
