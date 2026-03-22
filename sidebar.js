var scanBtn = document.getElementById('scanBtn');
var statusEl = document.getElementById('status');
var errorEl = document.getElementById('error');
var castResultEl = document.getElementById('castResult');
var deviceListEl = document.getElementById('deviceList');

scanBtn.addEventListener('click', function() {
  scanBtn.disabled = true;
  deviceListEl.innerHTML = '';
  errorEl.style.display = 'none';
  castResultEl.style.display = 'none';
  statusEl.textContent = 'Scanning...';
  iina.postMessage('execScan', {});
});

iina.onMessage('status', function(data) {
  statusEl.textContent = data.text;
});

iina.onMessage('devices', function(data) {
  scanBtn.disabled = false;
  if (data.error) {
    errorEl.textContent = data.error;
    errorEl.style.display = 'block';
    statusEl.textContent = '';
  }
  if (data.devices && data.devices.length > 0) {
    errorEl.style.display = 'none';
    statusEl.textContent = '';
    deviceListEl.innerHTML = '';
    data.devices.forEach(function(dev) {
      var card = document.createElement('div');
      card.className = 'device-card';

      var nameEl = document.createElement('div');
      nameEl.className = 'device-name';
      nameEl.textContent = dev.name;

      var ipEl = document.createElement('div');
      ipEl.className = 'device-ip';
      ipEl.textContent = dev.ip;

      var btn = document.createElement('button');
      btn.className = 'cast-btn';
      btn.textContent = 'Cast';
      btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = '...';
        castResultEl.style.display = 'none';
        iina.postMessage('castTo', { ip: dev.ip, port: dev.port });
      });

      card.appendChild(nameEl);
      card.appendChild(ipEl);
      card.appendChild(btn);
      deviceListEl.appendChild(card);
    });
  }
});

iina.onMessage('castResult', function(data) {
  document.querySelectorAll('.cast-btn').forEach(function(b) {
    b.disabled = false;
    b.textContent = 'Cast';
  });
  castResultEl.className = data.ok ? 'ok' : 'fail';
  castResultEl.textContent = data.ok ? '✓ Casting started!' : '✗ ' + (data.error || 'Cast failed.');
  castResultEl.style.display = 'block';
});
