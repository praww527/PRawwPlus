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
  <!-- Call Manager Dialplan — domain: ${fsDomain} -->
  <context name="default">

    <!--
      Internal extension-to-extension calls (1000–9999).
      Ring timeout: 30 seconds. If not answered, route to voicemail.
      mod_voicemail must be loaded on the FreeSWITCH server.
    -->
    <extension name="internal_extensions">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$">
        <!-- Caller/callee IDs -->
        <action application="set" data="effective_caller_id_name=\${caller_id_name}"/>
        <action application="set" data="effective_caller_id_number=\${caller_id_number}"/>

        <!-- Ring for 30 seconds before voicemail -->
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=true"/>

        <!-- Send early media (ringback) so the caller hears ringing -->
        <action application="set" data="ringback=\${us-ring}"/>

        <!-- Check if the extension is registered; reject with 'does not exist' if not -->
        <action application="set" data="continue_on_fail=false"/>

        <!-- Bridge to the destination extension -->
        <action application="bridge" data="verto_contact/\$1@${fsDomain}"/>

        <!--
          If bridge fails/times out, fall through to voicemail.
          NORMAL_CLEARING = callee hung up before answering → voicemail
          USER_BUSY       = callee is on another call → busy tone
          NO_ANSWER       = ring timeout → voicemail
        -->
        <action application="answer"/>
        <action application="sleep" data="1000"/>
        <action application="voicemail" data="default ${fsDomain} \$1"/>
      </condition>
    </extension>

    <!--
      Voicemail direct access: dial *97 or *98<ext> to check messages.
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
      Busy extensions: if the callee is on a call and call waiting is not enabled,
      FreeSWITCH returns USER_BUSY from the bridge action above and falls through
      to voicemail. No extra extension needed — handled by continue_on_fail=false
      on the bridge and fall-through voicemail action.
    -->

    <!--
      Invalid / unallocated numbers: any destination not matching 1000–9999 or
      the voicemail codes above gets a 404 Not Found response.
    -->
    <extension name="invalid_number">
      <condition field="destination_number" expression="^(.*)$">
        <action application="log" data="WARNING Rejected unmatched destination: \$1"/>
        <action application="respond" data="404 Number does not exist"/>
      </condition>
    </extension>

  </context>
</include>`;
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
