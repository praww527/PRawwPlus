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
      TLS is terminated by the API server proxy — browsers connect via
      wss://app-domain/api/verto/ws and the proxy forwards to ws://fs:8081.
    -->
    <profile name="default-v4">
      <param name="bind-local" value="0.0.0.0:8081"/>
      <param name="ext-rtp-ip" value="${fsIp}"/>
      <param name="ext-sip-ip" value="${fsIp}"/>

      <!--
        STUN: FreeSWITCH uses this to discover its public IP when building
        ICE candidates. Without it, WebRTC clients may receive private/local
        IPs in the SDP and fail to connect (one-way audio or no audio).
      -->
      <param name="stun-ip" value="stun.l.google.com"/>
      <param name="stun-port" value="19302"/>
      <param name="stun-enabled" value="true"/>
      <param name="stun-auto-disable" value="false"/>

      <param name="local-network" value="localnet.auto"/>
      <param name="outbound-codec-string" value="opus,PCMU,PCMA"/>
      <param name="inbound-codec-string" value="opus,PCMU,PCMA"/>
      <param name="apply-candidate-acl" value="any_v4.auto"/>
      <param name="rtp-timeout-sec" value="30"/>
      <param name="rtp-hold-timeout-sec" value="120"/>
      <param name="timer-name" value="soft"/>
      <param name="enable-text" value="false"/>
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
