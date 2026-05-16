/**
 * Minimal structural type for a chrome-remote-interface client. We avoid
 * importing the library's `Client` type because its declaration is loose
 * (`any`-typed event names) and pollutes call sites.
 */
export interface CdpClient {
  send: (method: string, params?: unknown) => Promise<unknown>;
  on: (event: string, handler: (params: unknown) => void) => void;
  off: (event: string, handler: (params: unknown) => void) => void;
  close: () => Promise<void>;
}
