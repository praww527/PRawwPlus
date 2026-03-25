/**
 * FreeSWITCH XML configuration generators.
 *
 * Produces the XML files that need to live on the FreeSWITCH server so it can:
 *  1. Authenticate users via mod_xml_curl → our /api/freeswitch/directory endpoint
 *  2. Route inbound/outbound calls and fire webhooks to our /api/calls/webhook/freeswitch
 *  3. Accept WebRTC connections from browsers via mod_verto
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
      TLS is terminated by the Replit API server proxy — browsers connect to
      wss://replit-domain/api/verto/ws and the proxy forwards to ws://fs:8081.
    -->
    <profile name="default-v4">
      <param name="bind-local" value="0.0.0.0:8081"/>
      <param name="ext-rtp-ip" value="${fsIp}"/>
      <param name="ext-sip-ip" value="${fsIp}"/>
      <param name="local-network" value="localnet.auto"/>
      <param name="outbound-codec-string" value="opus,PCMU,PCMA,H264,VP8"/>
      <param name="inbound-codec-string" value="opus,PCMU,PCMA,H264,VP8"/>
      <param name="apply-candidate-acl" value="any_v4.auto"/>
      <param name="rtp-timeout-sec" value="30"/>
      <param name="rtp-hold-timeout-sec" value="120"/>
      <param name="mcast-ip" value="239.1.1.1"/>
      <param name="mcast-port" value="1337"/>
      <param name="timer-name" value="soft"/>
      <param name="enable-text" value="false"/>
    </profile>
  </profiles>
</configuration>`;
}

export function dialplanXml(appUrl: string, fsDomain: string): string {
  const webhookUrl = `${appUrl}/api/calls/webhook/freeswitch`;
  return `<include>
  <!-- Call Manager Dialplan -->
  <context name="default">

    <!-- Internal extension-to-extension calls (1000-9999) -->
    <extension name="internal_extensions">
      <condition field="destination_number" expression="^(1[0-9]{3})$">
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="set" data="continue_on_fail=false"/>

        <!-- Fire CHANNEL_ANSWER webhook -->
        <action application="set" data="api_on_answer=curl ${webhookUrl} POST event=CHANNEL_ANSWER&amp;callId=\${variable_sip_h_X-CallManager-CallId}&amp;userId=\${variable_sip_h_X-CallManager-UserId}"/>

        <action application="bridge" data="verto_contact/\$1@${fsDomain}"/>

        <!-- Fire CHANNEL_HANGUP webhook after bridge ends -->
        <action application="set" data="hangup_cause=\${bridge_hangup_cause}"/>
        <action application="curl" data="${webhookUrl} POST event=CHANNEL_HANGUP&amp;callId=\${variable_sip_h_X-CallManager-CallId}&amp;userId=\${variable_sip_h_X-CallManager-UserId}&amp;duration=\${billsec}"/>
      </condition>
    </extension>

    <!-- Catch-all for unmatched destinations -->
    <extension name="unmatched">
      <condition field="destination_number" expression="^(.*)$">
        <action application="log" data="WARNING Unmatched destination: \$1"/>
        <action application="respond" data="404"/>
      </condition>
    </extension>

  </context>
</include>`;
}

export function eventSocketConf(): string {
  return `<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="nat-map" value="false"/>
    <param name="listen-ip" value="0.0.0.0"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="ClueCon"/>
    <param name="apply-inbound-acl" value="any_v4.auto"/>
  </settings>
</configuration>`;
}
