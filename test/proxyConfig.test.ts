import { describe, it, expect } from 'vitest';
import { pickProxyFromEnv } from '../src/main/provision/proxyConfig';

describe('pickProxyFromEnv', () => {
  it('returns null when no proxy env vars are set', () => {
    expect(pickProxyFromEnv({})).toBeNull();
  });

  it('prefers HTTPS_PROXY over HTTP_PROXY', () => {
    const r = pickProxyFromEnv({ HTTPS_PROXY: 'https-proxy:8443', HTTP_PROXY: 'http-proxy:80' });
    expect(r).toEqual({ proxyRules: 'https-proxy:8443' });
  });

  it('falls back to HTTP_PROXY when HTTPS_PROXY is absent', () => {
    expect(pickProxyFromEnv({ HTTP_PROXY: 'http-proxy:80' })).toEqual({ proxyRules: 'http-proxy:80' });
  });

  it('accepts lowercase variants (https_proxy/http_proxy)', () => {
    expect(pickProxyFromEnv({ https_proxy: 'p:1' })).toEqual({ proxyRules: 'p:1' });
    expect(pickProxyFromEnv({ http_proxy: 'p:2' })).toEqual({ proxyRules: 'p:2' });
  });

  it('includes proxyBypassRules from NO_PROXY when set', () => {
    const r = pickProxyFromEnv({ HTTPS_PROXY: 'p:1', NO_PROXY: 'localhost,127.0.0.1' });
    expect(r).toEqual({ proxyRules: 'p:1', proxyBypassRules: 'localhost,127.0.0.1' });
  });

  it('ignores empty proxy values', () => {
    expect(pickProxyFromEnv({ HTTPS_PROXY: '', HTTP_PROXY: '' })).toBeNull();
  });

  // Normalization — Chromium's proxyRules expects host:port, NOT a URL like http://host:port.
  // Passing the raw URL form yields ERR_NO_SUPPORTED_PROXIES at the renderer.

  it('strips http:// scheme so Chromium accepts proxyRules', () => {
    expect(pickProxyFromEnv({ HTTPS_PROXY: 'http://proxy.corp:8080' })).toEqual({ proxyRules: 'proxy.corp:8080' });
  });

  it('strips https:// scheme similarly', () => {
    expect(pickProxyFromEnv({ HTTPS_PROXY: 'https://proxy.corp:8443' })).toEqual({ proxyRules: 'proxy.corp:8443' });
  });

  it('strips embedded user:pass auth and trailing slash', () => {
    expect(pickProxyFromEnv({ HTTPS_PROXY: 'http://user:pass@proxy.corp:8080/' })).toEqual({ proxyRules: 'proxy.corp:8080' });
  });

  it('keeps socks://, socks4://, socks5:// prefixes intact (Chromium supports those)', () => {
    expect(pickProxyFromEnv({ HTTPS_PROXY: 'socks5://proxy:1080' })).toEqual({ proxyRules: 'socks5://proxy:1080' });
    expect(pickProxyFromEnv({ HTTPS_PROXY: 'socks4://proxy:1080' })).toEqual({ proxyRules: 'socks4://proxy:1080' });
  });

  it('passes bare host:port unchanged', () => {
    expect(pickProxyFromEnv({ HTTPS_PROXY: 'proxy.corp:8080' })).toEqual({ proxyRules: 'proxy.corp:8080' });
  });

  it('returns null when value is only whitespace', () => {
    expect(pickProxyFromEnv({ HTTPS_PROXY: '   ' })).toBeNull();
  });
});
