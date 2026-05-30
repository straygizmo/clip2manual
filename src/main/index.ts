import { app, BrowserWindow, session, desktopCapturer } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { registerAssetScheme, registerAssetProtocol } from './assetProtocol';
import { stopVoicevoxEngine } from './ipc/tts';
import { pickProxyFromEnv } from './provision/proxyConfig';
import { setProxyCreds } from './provision/download';
import { setMainLanguage } from './i18n';

registerAssetScheme(); // app ready より前に呼ぶ

function createWindow(): void {
  // OSロケールを preload に同期的に渡す（renderer 側 i18n の初期化に使う）。
  const locale = app.getLocale() || 'ja';
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--c2m-locale=${locale}`],
      // 録画中にウィンドウを背面化してもオーディオMediaRecorderが
      // スロットルされないようにする（getDisplayMediaの映像は影響を受けないが、
      // getUserMediaのマイク→MediaRecorderはレンダラ非アクティブ時に停止する）。
      backgroundThrottling: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  // OS ロケールに応じて main 側の言語を確定する（resolve* 系より前）。
  setMainLanguage(app.getLocale());

  // HTTPS_PROXY/HTTP_PROXY/NO_PROXY が設定されていれば既定セッションに反映する。
  // net.fetch（provision/download.ts が使用）はこの設定を尊重する。
  // 環境変数が無ければ Chromium が Windows システムプロキシを自動採用する。
  const proxy = pickProxyFromEnv(process.env);
  if (proxy) {
    await session.defaultSession.setProxy({
      proxyRules: proxy.proxyRules,
      ...(proxy.proxyBypassRules ? { proxyBypassRules: proxy.proxyBypassRules } : {}),
    });
    // 社内プロキシが Basic ではなく NTLM/Negotiate（Windows 統合認証）を要求する場合に備え、
    // 全ホストで Windows SSO を許可する。Chromium が NTLM/Negotiate チャレンジを受けると
    // login イベントを介さず透過的に Windows 資格情報で応答する。
    session.defaultSession.allowNTLMCredentialsForDomains('*');
    // download.ts 側の per-request login ハンドラへ資格情報を渡す
    // （net.fetch では app.on('login') が発火しないため net.request 直叩きへ移行）。
    if (proxy.username) {
      setProxyCreds({ username: proxy.username, password: proxy.password ?? '' });
    }
    console.log('[proxy] proxyRules=%s, hasCreds=%s', proxy.proxyRules, proxy.username ? 'yes' : 'no');
  }

  // すべての認証チャレンジを観測（切り分け用）。Basic は埋め込み認証で応答、
  // NTLM/Negotiate は上の allowNTLMCredentialsForDomains が透過処理するためここに来ない想定。
  app.on('login', (event, _wc, _req, authInfo, callback) => {
    console.log('[auth challenge]', {
      isProxy: authInfo.isProxy, scheme: authInfo.scheme, host: authInfo.host, port: authInfo.port, realm: authInfo.realm,
    });
    if (!authInfo.isProxy) return;          // サーバ側 401 はスルー
    if (!proxy?.username) return;           // 資格情報未設定なら既定（キャンセル）に任せる
    event.preventDefault();
    callback(proxy.username, proxy.password ?? '');
  });

  // audio: 'loopback' is ignored by the renderer (it calls getDisplayMedia with audio:false);
  // narration is captured separately via getUserMedia (the microphone) in ScreenRecorder.
  registerIpc();
  registerAssetProtocol();
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        // TODO phase-2+: allow the user to choose which display/window to capture.
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch((err) => {
        console.error('Failed to enumerate screen sources for display media', err);
        // Resolve with no video so the renderer's getDisplayMedia rejects instead of hanging.
        callback({});
      });
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopVoicevoxEngine();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
