import CDP from 'chrome-remote-interface';

import { type AttachOptions } from '@fast-browser/core';
import { type CdpClient, CdpDriverBase } from '@fast-browser/adapter-cdp-shared';

interface RawTargetEntry {
  id: string;
  type: string;
  url: string;
}

export interface CdpNodeDriverOptions {
  /** Port the launched Chrome instance is listening on. Required. */
  port: number;
  /** Optional explicit target id; otherwise picks the first existing page. */
  targetId?: string;
}

/**
 * BrowserDriver against a launched Chromium attached over
 * chrome-remote-interface. All CDP method translation lives in
 * {@link CdpDriverBase}; this class only handles target discovery /
 * connection setup.
 */
export class CdpNodeDriver extends CdpDriverBase {
  private readonly port: number;
  private readonly explicitTargetId?: string;

  constructor(opts: CdpNodeDriverOptions) {
    super();
    this.port = opts.port;
    if (opts.targetId !== undefined) {
      this.explicitTargetId = opts.targetId;
    }
  }

  override async attach(opts: AttachOptions): Promise<void> {
    if (this.client) {
      return;
    }
    const target = this.explicitTargetId
      ?? (await this.findOrCreateTarget(opts.url));
    this.client = (await CDP({
      port: this.port,
      target,
    })) as unknown as CdpClient;

    await this.enableCommonDomains();

    if (opts.url) {
      await this.navigate(opts.url);
    }
  }

  private async findOrCreateTarget(url?: string): Promise<string> {
    const targets = (await CDP.List({ port: this.port })) as RawTargetEntry[];
    const existing = targets.find((t) => t.type === 'page' && t.url !== '');
    if (existing) {
      return existing.id;
    }
    const created = (await CDP.New({
      port: this.port,
      url: url ?? 'about:blank',
    })) as { id: string };
    return created.id;
  }
}
