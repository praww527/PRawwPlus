import { useEffect } from "react";
import { useGetVertoConfig } from "@workspace/api-client-react";
import { useCall } from "@/context/CallContext";

export function VertoInit() {
  const { data } = useGetVertoConfig();
  const { setVertoConfig } = useCall();

  useEffect(() => {
  if (data) {
    setVertoConfig({
      ...data,
      wsUrl: "ws://rtc.praww.co.za:8081"
    });
  }
}, [data, setVertoConfig]);

  return null;
}
