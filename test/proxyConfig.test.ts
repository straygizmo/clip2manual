import { describe, it, expect } from 'vitest';
import { pickProxyFromEnv } from '../src/main/provision/proxyConfig';

describe('pickProxyFromEnv', () => {
  it('returns null when no proxy env vars are set', () => {
    expect(pickProxyFromEnv({})).toBeNull();
  });

  it('prefers HTTPS_PROXY over HTTP_PROXY', () => {
    const r = pickProxyFromEnv({ HTTPS_PROXY: 'http://https-proxy:8443', HTTP_PROXY: 'http://http-proxy:80' });
    expect(r).toEqual({ proxyRules: 'http://https-proxy:8443' });
  });

  it('falls back to HTTP_PROXY when HTTPS_PROXY is absent', () => {
    expect(pickProxyFromEnv({ HTTP_PROXY: 'http://http-proxy:80' })).toEqual({ proxyRules: 'http://http-proxy:80' });
  });

  it('accepts lowercase variants (https_proxy/http_proxy)', () => {
    expect(pickProxyFromEnv({ https_proxy: 'http://p:1' })).toEqual({ proxyRules: 'http://p:1' });
    expect(pickProxyFromEnv({ http_proxy: 'http://p:2' })).toEqual({ proxyRules: 'http://p:2' });
  });

  it('includes proxyBypassRules from NO_PROXY when set', () => {
    const r = pickProxyFromEnv({ HTTPS_PROXY: 'http://p:1', NO_PROXY: 'localhost,127.0.0.1' });
    expect(r).toEqual({ proxyRules: 'http://p:1', proxyBypassRules: 'localhost,127.0.0.1' });
  });

  it('ignores empty proxy values', () => {
    expect(pickProxyFromEnv({ HTTPS_PROXY: '', HTTP_PROXY: '' })).toBeNull();
  });
});
