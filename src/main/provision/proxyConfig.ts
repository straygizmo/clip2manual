/** Electron の `session.setProxy` に渡せる形のプロキシ設定。 */
export interface ProxyConfig {
  proxyRules: string;
  /** 例: "localhost,127.0.0.1,*.internal" */
  proxyBypassRules?: string;
}

/**
 * 環境変数の値（例: "http://proxy.corp:8080"）を Chromium `proxyRules` が
 * 受け付ける形（"proxy.corp:8080"）に正規化する。
 * - http(s):// は剥がす（URL 形式のまま渡すと ERR_NO_SUPPORTED_PROXIES になる）
 * - 埋め込み認証 (`user:pass@`) とパス・末尾スラッシュも捨てる（認証は別途 `app.on('login')` が必要）
 * - socks://, socks4://, socks5:// は Chromium が直接サポートするので維持
 */
function normalizeProxyValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^socks[45]?:\/\//i.test(trimmed)) return trimmed;
  // `new URL` would drop default-port like ":80" for http or ":443" for https
  // (URL spec normalization). Use regex strip instead so the port is preserved verbatim.
  let s = trimmed.replace(/^https?:\/\//i, '');
  s = s.replace(/^[^@/]*@/, '');     // drop "user[:pass]@" if present
  s = s.replace(/[/?#].*$/, '');     // drop path/query/fragment
  return s;
}

/**
 * 標準的なプロキシ環境変数（HTTPS_PROXY/HTTP_PROXY/NO_PROXY、大文字小文字両方）から
 * Electron `session.setProxy()` 用の設定を組み立てる純関数。何も無ければ null。
 * 取得順は HTTPS_PROXY → https_proxy → HTTP_PROXY → http_proxy（最初に見つかった非空値）。
 * 値は normalizeProxyValue で host:port 形に整える。
 */
export function pickProxyFromEnv(env: Record<string, string | undefined>): ProxyConfig | null {
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!raw) return null;
  const proxyRules = normalizeProxyValue(raw);
  if (!proxyRules) return null;
  const bypass = env.NO_PROXY || env.no_proxy;
  return bypass ? { proxyRules, proxyBypassRules: bypass } : { proxyRules };
}
