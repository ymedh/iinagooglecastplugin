const CAST_PORT = 8009;

function sanitizeText(str) {
  return String(str).replace(/[^a-zA-Z0-9 ._\-:@]/g, '');
}

function validateIP(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split('.').every(n => parseInt(n) <= 255);
}

async function run(cmd) {
  try {
    const result = await utils.exec('/bin/sh', ['-c', cmd]);
    return result.stdout || '';
  } catch (e) {
    return '';
  }
}

async function findCatt() {
  const candidates = [
    '/Library/Frameworks/Python.framework/Versions/3.11/bin/catt',
    '/usr/local/bin/catt',
    '/opt/homebrew/bin/catt',
    '/usr/bin/catt',
  ];
  for (const p of candidates) {
    const ok = await run(`test -f "${p}" && echo yes`);
    if (ok.trim() === 'yes') return p;
  }
  const whichOut = await run('which catt 2>/dev/null');
  if (whichOut.trim()) return whichOut.trim();
  const pyCheck = await run('python3 -m catt --version 2>/dev/null');
  if (pyCheck.trim()) return 'python3 -m catt';
  return null;
}

async function discoverDevices() {
  iina.log('[Cast] Starting discovery...');
  sidebar.sendMessage('status', { text: 'Scanning...' });

  // Use dns-sd browse with a short timeout, parse results
  const browseOut = await run('timeout 5 dns-sd -B _googlecast._tcp local 2>/dev/null');
  iina.log('[Cast] browse output: ' + browseOut);

  const instances = [];
  for (const line of browseOut.split('\n')) {
    const m = line.match(/Add\s+\S+\s+\d+\s+\S+\s+_googlecast\._tcp\.\s+(.+)/);
    if (m) instances.push(m[1].trim());
  }

  if (instances.length === 0) {
    sidebar.sendMessage('devices', { devices: [], error: 'No Cast devices found. Make sure your Chromecast is on the same WiFi network.' });
    return;
  }

  iina.log('[Cast] Found instances: ' + instances.join(', '));
  sidebar.sendMessage('status', { text: `Found ${instances.length} device(s), resolving...` });

  const devices = [];

  for (const instance of instances) {
    const lookupOut = await run(`timeout 3 dns-sd -L "${instance}" _googlecast._tcp local 2>/dev/null`);
    iina.log('[Cast] lookup: ' + lookupOut);

    let friendlyName = null;
    let hostname = null;

    for (const line of lookupOut.split('\n')) {
      const hostMatch = line.match(/can be reached at ([a-zA-Z0-9\-]+\.local)/i);
      if (hostMatch) hostname = hostMatch[1];
      const fnMatch = line.match(/fn=([^" \t]+)/i);
      if (fnMatch) friendlyName = decodeURIComponent(fnMatch[1].replace(/\\032/g, ' ').replace(/\\(.)/g, '$1')).trim();
    }

    const label = sanitizeText(friendlyName || instance);
    iina.log('[Cast] name=' + label + ' hostname=' + hostname);

    if (!hostname) continue;

    // Resolve hostname to IP via ping (fast, built-in)
    const pingOut = await run(`ping -c 1 -W 2 -t 2 "${hostname}" 2>&1`);
    const ipMatch = pingOut.match(/\((\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\)/);
    if (!ipMatch || !validateIP(ipMatch[1])) {
      iina.log('[Cast] Could not resolve IP for ' + hostname);
      continue;
    }

    const ip = ipMatch[1];
    iina.log('[Cast] Resolved ' + hostname + ' -> ' + ip);
    devices.push({ name: label, ip, port: CAST_PORT });
    sidebar.sendMessage('devices', { devices: devices.slice() });
  }

  if (devices.length === 0) {
    sidebar.sendMessage('devices', { devices: [], error: 'Device found but IP could not be resolved. Check IINA logs.' });
  } else {
    sidebar.sendMessage('status', { text: `${devices.length} device(s) ready.` });
  }
}

async function castToDevice(ip, port) {
  const url = iina.core.url;
  if (!url) {
    sidebar.sendMessage('castResult', { ok: false, error: 'No media loaded in IINA.' });
    return;
  }
  if (!validateIP(ip)) {
    sidebar.sendMessage('castResult', { ok: false, error: 'Invalid IP.' });
    return;
  }

  const cattCmd = await findCatt();
  if (!cattCmd) {
    sidebar.sendMessage('castResult', {
      ok: false,
      error: 'catt not found. Install it: pip3 install catt  (then restart IINA)'
    });
    return;
  }

  iina.log('[Cast] Using catt: ' + cattCmd);
  iina.log('[Cast] Casting ' + url + ' to ' + ip + ':' + port);

  const safeUrl = url.replace(/'/g, "'\\''");
  const out = await run(`${cattCmd} -d "${ip}" cast "${safeUrl}" 2>&1`);
  iina.log('[Cast] catt output: ' + out);

  const ok = out.length === 0 || (!out.toLowerCase().includes('error') && !out.toLowerCase().includes('traceback'));
  sidebar.sendMessage('castResult', { ok, error: ok ? null : out.slice(0, 300) });
}

sidebar.onMessage('execScan', function() {
  discoverDevices().catch(function(e) {
    iina.log('[Cast] Error: ' + e);
    sidebar.sendMessage('devices', { devices: [], error: String(e) });
  });
});

sidebar.onMessage('castTo', function(data) {
  castToDevice(data.ip, data.port || CAST_PORT).catch(function(e) {
    iina.log('[Cast] Cast error: ' + e);
    sidebar.sendMessage('castResult', { ok: false, error: String(e) });
  });
});
