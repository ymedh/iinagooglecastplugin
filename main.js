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
  // --- Python: check known paths then fall back to `which` ---
  const pythonCandidates = [
    '/usr/bin/python3',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',
  ];
  // Dynamically add versioned framework paths for 3.9–3.15
  for (let v = 9; v <= 15; v++) {
    pythonCandidates.push(
      `/Library/Frameworks/Python.framework/Versions/3.${v}/bin/python3`
    );
  }
  for (const p of pythonCandidates) {
    const ok = (await utils.exec('/bin/sh', ['-c', `test -f "${p}" && echo yes`])).stdout.trim();
    if (ok === 'yes') { PYTHON = p; break; }
  }
  if (!PYTHON) {
    const w = (await utils.exec('/bin/sh', ['-c', 'which python3 2>/dev/null'])).stdout.trim();
    if (w) PYTHON = w;
  }

  // --- server.py: resolve path dynamically from @data, no hardcoded plugin folder name ---
  const serverDest = utils.resolvePath('@data/server.py');
  // Walk up from @data to find the plugin's own server.py by searching sibling plugin dirs
  const dataDir = serverDest.replace(/\/server\.py$/, '');
  const pluginsDir = dataDir.replace(/\/\.data\/[^/]+$/, '');
  // Find the actual plugin folder name at runtime (handles both -dev and installed variants)
  const findSrc = `find "${pluginsDir}" -maxdepth 2 -name "server.py" ! -path "*/.data/*" 2>/dev/null | head -1`;
  const serverSrc = (await utils.exec('/bin/sh', ['-c', findSrc])).stdout.trim();
  if (serverSrc) {
    await utils.exec('/bin/sh', ['-c', `cp "${serverSrc}" "${serverDest}"`]);
  }
  SERVER_PY = serverDest;

  // --- cloudflared: check known paths then `which` then brew install ---
  const cfCandidates = [
    '/usr/local/bin/cloudflared',
    '/opt/homebrew/bin/cloudflared',
    '/opt/homebrew/opt/cloudflared/bin/cloudflared',
  ];
  for (const p of cfCandidates) {
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

  // --- Chrome: find whichever Chromium-based browser is available ---
  const chromeCandidates = [
    'Google Chrome', 'Chromium', 'Google Chrome Canary', 'Google Chrome Beta', 'Brave Browser', 'Microsoft Edge'
  ];
  for (const app of chromeCandidates) {
    const ok = (await utils.exec('/bin/sh', ['-c', `test -d "/Applications/${app}.app" && echo yes`])).stdout.trim();
    if (ok === 'yes') { CHROME = app; break; }
  }
  // Also check ~/Applications
  if (!CHROME) {
    for (const app of chromeCandidates) {
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
  let tunnelUrl = null;
  for (let i = 0; i < 20; i++) {
    await utils.exec('/bin/sh', ['-c', 'sleep 0.5']);
    const log = (await utils.exec('/bin/sh', ['-c', 'cat /tmp/iina_cf.log 2>/dev/null'])).stdout;
    const m = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) { tunnelUrl = m[0]; break; }
  }
  if (!tunnelUrl) return null;

  // Hotel DNS may block *.trycloudflare.com resolution for apps (mDNSResponder).
  // Use DNS-over-HTTPS to resolve the hostname and write a /etc/hosts entry
  // so all apps on this machine can reach the tunnel URL.
  const host = tunnelUrl.replace('https://', '');
  const dohResult = (await utils.exec('/bin/sh', ['-c',
    `curl -sf "https://cloudflare-dns.com/dns-query?name=${host}&type=A" ` +
    `-H "accept: application/dns-json" | python3 -c ` +
    `"import sys,json; d=json.load(sys.stdin); ` +
    `print(next((a['data'] for a in d.get('Answer',[]) if a['type']==1),''))" 2>/dev/null`
  ])).stdout.trim();

  if (dohResult) {
    // Remove any stale trycloudflare entries then add the resolved IP
    await utils.exec('/bin/sh', ['-c',
      `sudo sh -c "grep -v trycloudflare /etc/hosts > /tmp/hosts_tmp && ` +
      `echo '${dohResult} ${host}' >> /tmp/hosts_tmp && cp /tmp/hosts_tmp /etc/hosts"`
    ]);
    await utils.exec('/bin/sh', ['-c', 'sudo killall -HUP mDNSResponder 2>/dev/null; sleep 0.5']);
  }

  return tunnelUrl;
}

function buildCastPage(mediaUrl, tunnelUrl) {
  const so = '<scr' + 'ipt>';
  const sc = '<' + '/scr' + 'ipt>';
  const infoHtml = tunnelUrl
    ? `<p>Public URL (works on any network):<br><a href="${tunnelUrl}/video" style="color:#4af">${tunnelUrl}/video</a></p>`
    : `<p>No tunnel active — local network only.</p>`;
  const js = `document.getElementById("v").src=${JSON.stringify(mediaUrl)};`;
  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>IINA Cast</title>',
    '<style>body{margin:0;background:#000;display:flex;flex-direction:column;align-items:center;',
    'justify-content:center;height:100vh;gap:12px;font-family:-apple-system,sans-serif;color:#fff}',
    'video{max-width:100%;max-height:75vh}p{font-size:12px;color:#aaa;text-align:center;margin:0;line-height:1.6}',
    'a{color:#4af}b{color:#fff}</style></head><body>',
    '<video id="v" controls autoplay></video>',
    '<p>Use the browser\'s <b>Cast</b> button — or paste the public URL into <b>getstreaming.tv</b> after pairing.</p>',
    infoHtml,
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
    sidebar.postMessage('status', { text: 'No Chromium-based browser found. Install Chrome or Chromium.', error: true });
    return;
  }
  const url = core.status.url || '';
  if (!url) {
    sidebar.postMessage('status', { text: 'No media loaded in IINA.', error: true });
    return;
  }

  const local = isLocalFile(url);
  const filePath = local ? toLocalPath(url) : '';

  await utils.exec('/bin/sh', ['-c', 'pkill -f "server.py" 2>/dev/null; sleep 0.3']);
  await utils.exec('/bin/sh', ['-c',
    `nohup "${PYTHON}" "${SERVER_PY}" "${filePath}" "/tmp/iina_cast_page.html" > /tmp/iina_cast.log 2>&1 &`
  ]);
  await utils.exec('/bin/sh', ['-c', 'sleep 1']);

  sidebar.postMessage('status', { text: 'Starting tunnel...' });
  const tunnelUrl = await getTunnelUrl();

  const mediaUrl = local
    ? (tunnelUrl ? tunnelUrl + '/video' : 'http://localhost:' + HTTP_PORT + '/video')
    : url;

  const html = buildCastPage(mediaUrl, tunnelUrl);
  const safeHtml = html.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  await utils.exec('/bin/sh', ['-c', "printf '%s' '" + safeHtml + "' > /tmp/iina_cast_page.html"]);

  await utils.exec('/bin/sh', ['-c', `open -a "${CHROME}" "http://localhost:${HTTP_PORT}"`]);

  if (tunnelUrl) {
    sidebar.postMessage('status', { text: '✅ ' + tunnelUrl + '/video' });
  } else {
    sidebar.postMessage('status', { text: '⚠️ Tunnel failed — local network only.', error: true });
  }
}
