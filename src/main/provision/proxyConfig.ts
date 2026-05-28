/** Electron の `session.setProxy` に渡せる形のプロキシ設定。 */
export interface ProxyConfig {
  proxyRules: string;
  /** 例: "localhost,127.0.0.1,*.internal" */
  proxyBypassRules?: string;
}

/**
 * 標準的なプロキシ環境変数（HTTPS_PROXY/HTTP_PROXY/NO_PROXY、大文字小文字両方）から
 * Electron `session.setProxy()` 用の設定を組み立てる純関数。何も無ければ null。
 * 取得順は HTTPS_PROXY → https_proxy → HTTP_PROXY → http_proxy（最初に見つかった非空値）。
 */
export function pickProxyFromEnv(env: Record<string, string | undefined>): ProxyConfig | null {
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!proxy) return null;
  const bypass = env.NO_PROXY || env.no_proxy;
  return bypass ? { proxyRules: proxy, proxyBypassRules: bypass } : { proxyRules: proxy };
}
