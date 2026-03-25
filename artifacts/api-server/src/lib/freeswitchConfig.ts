/**
 * FreeSWITCH XML configuration generators.
 *
 * Produces the XML files that need to live on the FreeSWITCH server so it can:
 *  1. Authenticate users via mod_xml_curl → our /api/freeswitch/directory endpoint
 *  2. Route internal extension-to-extension calls via mod_verto
 *  3. Accept WebRTC connections from browsers via mod_verto on port 8081 (plain WS)
 *
 * Call tracking is handled entirely by the ESL listener (freeswitchESL.ts) which
 * receives CHANNEL_ANSWER and CHANNEL_HANGUP_COMPLETE events directly from FreeSWITCH.
 * There is no dialplan webhook — the ESL Unique-ID matches the Verto callID.
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
        ALL local interfaces. This is required on cloud VMs that have both a
        private NIC (10.x.x.x) and a public NIC/alias (${fsIp}). Without this
        FreeSWITCH may bind only on the default-route interface and silently
        drop inbound RTP that arrives on another interface.
      -->
      <param name="rtp-ip" value="0.0.0.0"/>

      <!--
        NAT: This server is behind Oracle Cloud NAT (private 10.0.0.x → public ${fsIp}).
        Setting ext-rtp-ip and ext-sip-ip explicitly to the public IP ensures FreeSWITCH
        advertises the correct address in ICE candidates and SDP, preventing one-way
        or no-audio issues. We do NOT rely solely on STUN so that if STUN is temporarily
        unreachable the config still works.
      -->
      <param name="ext-rtp-ip" value="${fsIp}"/>
      <param name="ext-sip-ip" value="${fsIp}"/>

      <!--
        STUN: Used to validate/refresh the external IP. stun-auto-disable=false
        prevents FreeSWITCH from silently falling back to the private IP if a
        single STUN lookup fails on startup.
      -->
      <param name="stun-ip" value="stun.l.google.com"/>
      <param name="stun-port" value="19302"/>
      <param name="stun-enabled" value="true"/>
      <param name="stun-auto-disable" value="false"/>

      <!--
        local-network: Tells FreeSWITCH which subnets are local so it can
        skip NAT for those. any_v4.auto for ICE candidates allows all IPv4
        candidates from the browser to be considered (required for clients
        coming in from the public internet).
      -->
      <param name="local-network" value="localnet.auto"/>
      <param name="apply-candidate-acl" value="any_v4.auto"/>

      <!--
        Dialplan: Verto calls enter the "default" context where our
        call_manager dialplan handles extension routing.
      -->
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
        DTMF: RFC 2833/4733 telephone-event for keypad tones over RTP.
      -->
      <param name="enable-text" value="false"/>

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
  <!-- Call Manager Dialplan -->
  <context name="default">

    <!--
      Internal extension-to-extension calls (1000-9999).
      Call tracking (answer/hangup events) is handled by the ESL listener
      which matches on the Unique-ID (= Verto callID). No webhook needed here.
    -->
    <extension name="internal_extensions">
      <condition field="destination_number" expression="^([1-9][0-9]{3})$">
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="set" data="continue_on_fail=false"/>
        <action application="bridge" data="verto_contact/\$1@${fsDomain}"/>
      </condition>
    </extension>

    <!-- Catch-all: reject anything not matched above -->
    <extension name="unmatched">
      <condition field="destination_number" expression="^(.*)$">
        <action application="log" data="WARNING Unmatched destination: \$1"/>
        <action application="respond" data="404"/>
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
