/**
 * useContextTracking — fires a POST /user-context event when a screen mounts.
 *
 * This gives the LLM a navigation history to personalise future greetings:
 *   "I see you've been on the Interview screen before — want to continue?"
 *
 * Usage: call inside any screen component.
 *   useContextTracking("Interview", { interview_type: interviewType });
 */

import { useEffect } from "react";
import { SERVER_URL } from "../config";
import { getDeviceId } from "../utils/deviceId";

export function useContextTracking(
  screen: string,
  extra: Record<string, unknown> = {},
) {
  useEffect(() => {
    (async () => {
      try {
        const deviceId = await getDeviceId();
        await fetch(`${SERVER_URL}/user-context`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            device_id:  deviceId,
            event_type: "screen_visited",
            data:       { screen, ...extra },
          }),
        });
      } catch {
        // Non-fatal — context tracking should never block the UI
      }
    })();
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
