iina.console.log('[Cast] main.js loaded');

const { sidebar, utils, event, core } = iina;

event.on('iina.window-loaded', function() {
  sidebar.loadFile('sidebar.html');
  init().catch(function(e) { iina.console.log('[Cast] init error: ' + e); });

  sidebar.onMessage('cast', function() {
    openCastPage().catch(function(e) {
      sidebar.postMessage('status', { text: String(e), error: true });
    });
  });
});

const HTTP_PORT = 19421;
let PYTHON = null;
let SERVER_PY = null;
let CLOUDFLARED = null;
let CHROME = null;

async function init() {
  // Find python3
  const pythonCandidates = ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'];
  for (let v = 9; v <= 15; v++) pythonCandidates.push(`/Library/Frameworks/Python.framework/Versions/3.${v}/bin/python3`);
  for (const p of pythonCandidates) {
    const ok = (await utils.exec('/bin/sh', ['-c', `test -f "${p}" && echo yes`])).stdout.trim();
    if (ok === 'yes') { PYTHON = p; break; }
  }
  if (!PYTHON) {
    const w = (await utils.exec('/bin/sh', ['-c', 'which python3 2>/dev/null'])).stdout.trim();
    if (w) PYTHON = w;
  }

  // Copy server.py from plugin folder into @data (works for both -dev and installed)
  const serverDest = utils.resolvePath('@data/server.py');
  const pluginsDir = serverDest.replace(/\/\.data\/[^/]+$/, '');
  const findSrc = `find "${pluginsDir}" -maxdepth 2 -name "server.py" ! -path "*/.data/*" 2>/dev/null | head -1`;
  const serverSrc = (await utils.exec('/bin/sh', ['-c', findSrc])).stdout.trim();
  if (serverSrc) await utils.exec('/bin/sh', ['-c', `cp "${serverSrc}" "${serverDest}"`]);
  SERVER_PY = serverDest;

  // Find cloudflared
  for (const p of ['/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared', '/opt/homebrew/opt/cloudflared/bin/cloudflared']) {
    const ok = (await utils.exec('/bin/sh', ['-c', `test -f "${p}" && echo yes`])).stdout.trim();
    if (ok === 'yes') { CLOUDFLARED = p; break; }
  }
  if (!CLOUDFLARED) {
    const w = (await utils.exec('/bin/sh', ['-c', 'which cloudflared 2>/dev/null'])).stdout.trim();
    if (w) CLOUDFLARED = w;
  }
  if (!CLOUDFLARED) {
    await utils.exec('/bin/sh', ['-c', 'brew install cloudflared 2>/dev/null']);
    const w = (await utils.exec('/bin/sh', ['-c', 'which cloudflared 2>/dev/null'])).stdout.trim();
    CLOUDFLARED = w || null;
  }

  // Find Chrome or any Chromium-based browser
  for (const app of ['Google Chrome', 'Chromium', 'Brave Browser', 'Microsoft Edge', 'Google Chrome Canary']) {
    const ok = (await utils.exec('/bin/sh', ['-c', `test -d "/Applications/${app}.app" && echo yes`])).stdout.trim();
    if (ok === 'yes') { CHROME = app; break; }
  }
  if (!CHROME) {
    for (const app of ['Google Chrome', 'Chromium', 'Brave Browser', 'Microsoft Edge', 'Google Chrome Canary']) {
      const ok = (await utils.exec('/bin/sh', ['-c', `test -d "$HOME/Applications/${app}.app" && echo yes`])).stdout.trim();
      if (ok === 'yes') { CHROME = app; break; }
    }
  }

  iina.console.log('[Cast] python=' + PYTHON + ' server=' + SERVER_PY + ' cloudflared=' + CLOUDFLARED + ' chrome=' + CHROME);
}

function isLocalFile(url) {
  return url && (url.startsWith('file://') || url.startsWith('/'));
}

function toLocalPath(url) {
  const path = decodeURIComponent(url.slice(7));
  return path.startsWith('/') ? path : '/' + path;
}

async function getTunnelUrl() {
  if (!CLOUDFLARED) return null;
  await utils.exec('/bin/sh', ['-c', 'pkill -f "cloudflared tunnel" 2>/dev/null; sleep 0.3']);
  await utils.exec('/bin/sh', ['-c',
    `nohup "${CLOUDFLARED}" tunnel --url http://localhost:${HTTP_PORT} --no-autoupdate > /tmp/iina_cf.log 2>&1 &`
  ]);
  for (let i = 0; i < 20; i++) {
    await utils.exec('/bin/sh', ['-c', 'sleep 0.5']);
    const log = (await utils.exec('/bin/sh', ['-c', 'cat /tmp/iina_cf.log 2>/dev/null'])).stdout;
    const m = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) return m[0];
  }
  return null;
}

function buildCastPage(videoUrl, tunnelUrl) {
  const so = '<scr' + 'ipt>';
  const sc = '<' + '/scr' + 'ipt>';
  // videoUrl is the tunnel URL — reachable by the TV and by Chrome's Cast receiver
  const js = `document.getElementById("v").src=${JSON.stringify(videoUrl)};`;
  const info = tunnelUrl
    ? `<p>Public URL: <a href="${tunnelUrl}/video" style="color:#4af">${tunnelUrl}/video</a><br>Paste into getstreaming.tv after pairing your TV code.</p>`
    : `<p>No tunnel — local network only. Use Chrome's Cast button.</p>`;
  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>IINA Cast</title>',
    '<style>body{margin:0;background:#000;display:flex;flex-direction:column;align-items:center;',
    'justify-content:center;height:100vh;gap:12px;font-family:-apple-system,sans-serif;color:#fff}',
    'video{max-width:100%;max-height:75vh}p{font-size:12px;color:#aaa;text-align:center;margin:0;line-height:1.8}',
    'a{color:#4af}b{color:#fff}</style></head><body>',
    '<video id="v" controls autoplay></video>',
    info,
    so, js, sc,
    '</body></html>'
  ].join('\n');
}

async function openCastPage() {
  if (!PYTHON) {
    sidebar.postMessage('status', { text: 'Python 3 not found. Install from python.org.', error: true });
    return;
  }
  if (!CHROME) {
    sidebar.postMessage('status', { text: 'No Chrome/Chromium found. Install Google Chrome.', error: true });
    return;
  }
  const url = core.status.url || '';
  if (!url) {
    sidebar.postMessage('status', { text: 'No media loaded in IINA.', error: true });
    return;
  }

  const local = isLocalFile(url);
  const filePath = local ? toLocalPath(url) : '';

  // Start python server
  await utils.exec('/bin/sh', ['-c', 'pkill -f "server.py" 2>/dev/null; sleep 0.3']);
  await utils.exec('/bin/sh', ['-c',
    `nohup "${PYTHON}" "${SERVER_PY}" "${filePath}" "/tmp/iina_cast_page.html" > /tmp/iina_cast.log 2>&1 &`
  ]);
  await utils.exec('/bin/sh', ['-c', 'sleep 1']);

  sidebar.postMessage('status', { text: 'Starting tunnel...' });
  const tunnelUrl = await getTunnelUrl();

  // videoUrl: tunnel URL for local files (TV needs public URL), original URL for remote streams
  const videoUrl = local
    ? (tunnelUrl ? tunnelUrl + '/video' : 'http://localhost:' + HTTP_PORT + '/video')
    : url;

  const html = buildCastPage(videoUrl, tunnelUrl);
  const safeHtml = html.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  await utils.exec('/bin/sh', ['-c', "printf '%s' '" + safeHtml + "' > /tmp/iina_cast_page.html"]);

  // Open Chrome — it loads localhost which plays the video locally
  // The cast page also shows the public tunnel URL for getstreaming.tv
  await utils.exec('/bin/sh', ['-c', `open -a "${CHROME}" "http://localhost:${HTTP_PORT}"`]);

  if (tunnelUrl) {
    sidebar.postMessage('status', { text: '✅ ' + tunnelUrl + '/video' });
  } else {
    sidebar.postMessage('status', { text: '⚠️ Tunnel failed — local network only.', error: true });
  }
}
