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

async function resolveHostname(hostname) {
  iina.log('[Cast] Trying ping for: ' + hostname);
  const pingOut = await run('ping -c 1 -W 3 -t 3 "' + hostname + '" 2>&1');
  iina.log('[Cast] ping output: ' + pingOut);
  const m = pingOut.match(/\((\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\)/);
  if (m && validateIP(m[1])) {
    iina.log('[Cast] ping resolved to: ' + m[1]);
    return m[1];
  }

  iina.log('[Cast] Trying arp for: ' + hostname);
  await run('ping -c 1 -W 3 -t 3 "' + hostname + '" 2>/dev/null');
  const arpOut = await run('arp -a');
  iina.log('[Cast] arp output: ' + arpOut);
  const base = hostname.replace(/\.local$/, '');
  for (const line of arpOut.split('\n')) {
    if (line.toLowerCase().includes(base.toLowerCase())) {
      const am = line.match(/\((\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\)/);
      if (am && validateIP(am[1])) {
        iina.log('[Cast] arp resolved to: ' + am[1]);
        return am[1];
      }
    }
  }

  iina.log('[Cast] All resolution methods failed for: ' + hostname);
  return null;
}

async function discoverDevices() {
  iina.log('[Cast] Starting discovery...');
  sidebar.sendMessage('status', { text: 'Scanning...' });

  const browseOut = await run('timeout 6 dns-sd -B _googlecast._tcp local 2>/dev/null');
  iina.log('[Cast] browse output: ' + browseOut);

  const instances = [];
  for (const line of browseOut.split('\n')) {
    const m = line.match(/Add\s+\S+\s+\d+\s+\S+\s+_googlecast\._tcp\.\s+(.+)/);
    if (m) instances.push(m[1].trim());
  }

  if (instances.length === 0) {
    iina.log('[Cast] No devices found in browse');
    sidebar.sendMessage('devices', { devices: [], error: 'No Cast devices found. Make sure your Chromecast is on the same WiFi network.' });
    return;
  }

  iina.log('[Cast] Found instances: ' + instances.join(', '));
  sidebar.sendMessage('status', { text: 'Found ' + instances.length + ' device(s), resolving IPs...' });

  const devices = [];

  for (const instance of instances) {
    iina.log('[Cast] Looking up: ' + instance);
    const lookupOut = await run('timeout 4 dns-sd -L "' + instance + '" _googlecast._tcp local 2>/dev/null');
    iina.log('[Cast] lookup output: ' + lookupOut);

    let friendlyName = null;
    let hostname = null;

    for (const line of lookupOut.split('\n')) {
      const hostMatch = line.match(/can be reached at ([a-zA-Z0-9\-]+\.local)/i);
      if (hostMatch) hostname = hostMatch[1];
      const fnMatch = line.match(/fn=([^" ]+)/i);
      if (fnMatch) friendlyName = fnMatch[1].trim();
    }

    iina.log('[Cast] name=' + friendlyName + ' hostname=' + hostname);
    const label = sanitizeText(friendlyName || instance);

    if (!hostname) {
      iina.log('[Cast] No hostname, skipping');
      continue;
    }

    const ip = await resolveHostname(hostname);
    if (!ip) continue;

    devices.push({ name: label, ip: ip, port: CAST_PORT });
    sidebar.sendMessage('devices', { devices: devices.slice() });
  }

  if (devices.length === 0) {
    sidebar.sendMessage('devices', { devices: [], error: 'Device found but IP could not be resolved. Check IINA logs for details.' });
  } else {
    sidebar.sendMessage('status', { text: devices.length + ' device(s) ready.' });
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
  iina.log('[Cast] Casting ' + url + ' to ' + ip + ':' + port);
  const cattPath = await run('which catt 2>/dev/null');
  if (!cattPath.trim()) {
    sidebar.sendMessage('castResult', { ok: false, error: 'catt not installed. Run: pip3 install catt' });
    return;
  }
  const safeUrl = url.replace(/'/g, "'\\''");
  const out = await run("catt -d '" + ip + "' cast '" + safeUrl + "' 2>&1");
  const ok = !out.toLowerCase().includes('error');
  sidebar.sendMessage('castResult', { ok: ok, error: ok ? null : out.slice(0, 200) });
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
