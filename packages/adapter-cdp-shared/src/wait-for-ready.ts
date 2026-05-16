/**
 * Wait until the page settles: network goes idle for a stable window or a
 * hard timeout fires. Properly removes listeners so repeated calls do not
 * accumulate handlers on the chrome-remote-interface client (the source of
 * the MaxListenersExceededWarning seen in the v1 driver).
 *
 * Lives in its own module to keep the driver class focused on the
 * BrowserDriver method surface.
 */

import type { CdpClient } from './cdp-client.js';
import type { WaitForReadyOptions } from '@fast-browser/core';

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_STABLE_MS = 200;

const NETWORK_START_EVENT = 'Network.requestWillBeSent';
const NETWORK_END_EVENTS = [
  'Network.loadingFinished',
  'Network.loadingFailed',
] as const;

/**
 * Resolves once the network has been quiet for `stableMs`, or when
 * `timeoutMs` elapses — whichever comes first.
 */
export function waitForReady(
  client: CdpClient,
  opts: WaitForReadyOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stableMs = opts.stableMs ?? DEFAULT_STABLE_MS;

  return new Promise<void>((resolve) => {
    let inFlight = 0;
    let stableTimer: NodeJS.Timeout | null = null;
    let done = false;

    const onStart = (): void => {
      inFlight += 1;
      if (stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
    };

    const onEnd = (): void => {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) {
        armStableTimer();
      }
    };

    const armStableTimer = (): void => {
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
      stableTimer = setTimeout(() => {
        if (inFlight === 0) {
          finish();
        }
      }, stableMs);
    };

    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
      client.off(NETWORK_START_EVENT, onStart);
      for (const ev of NETWORK_END_EVENTS) {
        client.off(ev, onEnd);
      }
      resolve();
    };

    client.on(NETWORK_START_EVENT, onStart);
    for (const ev of NETWORK_END_EVENTS) {
      client.on(ev, onEnd);
    }

    armStableTimer();
    const hardCap = setTimeout(finish, timeoutMs);
    hardCap.unref?.();
  });
}
