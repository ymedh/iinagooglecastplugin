var castBtn = document.getElementById('castBtn');
var statusEl = document.getElementById('status');

castBtn.addEventListener('click', function() {
  statusEl.textContent = 'Opening...';
  statusEl.className = '';
  iina.postMessage('cast', {});
});

iina.onMessage('status', function(data) {
  statusEl.textContent = data.text;
  statusEl.className = data.error ? 'error' : '';
});
