iina.console.log('[Cast] main.js loaded');

const { sidebar, utils, event, core } = iina;

event.on('iina.window-loaded', function() {
  iina.console.log('[Cast] window loaded, loading sidebar');
  sidebar.loadFile('sidebar.html');
  init().catch(function(e) { iina.console.log('[Cast] init error: ' + e); });

  sidebar.onMessage('cast', function() {
    iina.console.log('[Cast] cast message received');
    openCastPage().catch(function(e) {
      iina.console.log('[Cast] Error: ' + e);
      sidebar.postMessage('status', { text: String(e), error: true });
    });
  });
});

const HTTP_PORT = 19421;
// Resolved at startup
let PYTHON = null;
let SERVER_PY = null;

async function init() {
  // Find python3
  for (const p of ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3']) {
    const ok = (await utils.exec('/bin/sh', ['-c', `test -f "${p}" && echo yes`])).stdout.trim();
    if (ok === 'yes') { PYTHON = p; break; }
  }
  if (!PYTHON) {
    const w = (await utils.exec('/bin/sh', ['-c', 'which python3 2>/dev/null'])).stdout.trim();
    if (w) PYTHON = w;
  }

  // Copy server.py to @data dir on every startup to keep it current
  const serverDest = utils.resolvePath('@data/server.py');
  // @data is at plugins/.data/<identifier>/ so plugins dir is two levels up
  const pluginsDir = serverDest.replace(/\/\.data\/.*$/, '');
  const serverSrc = pluginsDir + '/iinagooglecastplugin.iinaplugin-dev/server.py';
  await utils.exec('/bin/sh', ['-c', `cp "${serverSrc}" "${serverDest}"`]);
  SERVER_PY = serverDest;

  // Find python3 - try known locations
  for (const p of ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3']) {
    const ok = (await utils.exec('/bin/sh', ['-c', `test -f "${p}" && echo yes`])).stdout.trim();
    if (ok === 'yes') { PYTHON = p; break; }
  }
  if (!PYTHON) {
    const w = (await utils.exec('/bin/sh', ['-c', 'which python3 2>/dev/null'])).stdout.trim();
    if (w) PYTHON = w;
  }
  iina.console.log('[Cast] python=' + PYTHON + ' server=' + SERVER_PY);
}
const PAGE_HTML = '/tmp/iina_cast_page.html';

function isLocalFile(url) {
  return url && (url.startsWith('file://') || url.startsWith('/'));
}

function toLocalPath(url) {
  // file:///Volumes/... -> slice(7) gives /Volumes/...
  // file://Volumes/...  -> slice(7) gives Volumes/... (needs leading slash)
  const path = decodeURIComponent(url.slice(7));
  return path.startsWith('/') ? path : '/' + path;
}

async function run(cmd) {
  try { return (await utils.exec('/bin/sh', ['-c', cmd])).stdout || ''; }
  catch(e) { return ''; }
}

async function getLocalIP() {
  const out = (await utils.exec('/bin/sh', ['-c', 'ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null'])).stdout.trim();
  return out || '127.0.0.1';
}

function buildCastPage(mediaUrl) {
  const so = '<scr' + 'ipt>';
  const sc = '<' + '/scr' + 'ipt>';
  const js = 'document.getElementById("v").src=' + JSON.stringify(mediaUrl) + ';';
  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>IINA Cast</title>',
    '<style>body{margin:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:12px;font-family:-apple-system,sans-serif;color:#fff}video{max-width:100%;max-height:80vh}p{font-size:13px;color:#aaa;text-align:center;margin:0}b{color:#fff}</style>',
    '</head><body>',
    '<video id="v" controls autoplay></video>',
    '<p>Use the <b>Cast button</b> in Chrome\'s toolbar to cast to your device</p>',
    so, js, sc,
    '</body></html>'
  ].join('\n');
}

async function openCastPage() {
  if (!PYTHON) {
    sidebar.postMessage('status', { text: 'Python 3 not found. Please install it from python.org.', error: true });
    return;
  }
  const url = core.status.url || '';
  if (!url) {
    sidebar.postMessage('status', { text: 'No media loaded in IINA.', error: true });
    return;
  }

  const local = isLocalFile(url);
  const filePath = local ? toLocalPath(url) : '';
  const localIP = await getLocalIP();
  const mediaUrl = local ? ('http://' + localIP + ':' + HTTP_PORT + '/video') : url;
  const html = buildCastPage(mediaUrl);

  // Write cast page and launcher via shell
  const safeHtml = html.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  await utils.exec('/bin/sh', ['-c', "printf '%s' '" + safeHtml + "' > /tmp/iina_cast_page.html"]);

  const launcher = '/tmp/iina_cast_launch.sh';
  const script = [
    '#!/bin/sh',
    'pkill -f "server.py" 2>/dev/null',
    'sleep 0.5',
    'nohup "' + PYTHON + '" "' + SERVER_PY + '" "$1" "/tmp/iina_cast_page.html" > /tmp/iina_cast.log 2>&1 &',
    'sleep 1',
    'open -a "Google Chrome" "http://localhost:' + HTTP_PORT + '"'
  ].join('\n');
  const safeScript = script.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  await utils.exec('/bin/sh', ['-c', "printf '%s' '" + safeScript + "' > " + launcher + " && chmod +x " + launcher]);
  await utils.exec('/bin/sh', [launcher, filePath]);

  sidebar.postMessage('status', { text: 'Opening Chrome...' });
}


