# iina-plugin-googlecast

Cast videos playing in [IINA](https://iina.io) to any Google Cast device on your local network.

## Installation

In IINA: **Plugins → Plugin Manager → Install from GitHub**
```
ymedh/iinagooglecastplugin
```

## Features
- 📡 Discovers Google Cast devices via mDNS
- ▶️ Casts current video automatically when connected
- ⏸ Syncs pause, resume, and seek to Google Cast device
- 🖥 Shows casting overlay in IINA
- ⏹ Stop casting from sidebar or Plugins menu

## Security
- No credentials, API keys, or secrets in code
- All untrusted input sanitized before DOM insertion
- Network permission scoped to local network only
- IP addresses validated before use
- No external tracking or analytics

## Requirements
- IINA 1.3.0+
- macOS (dns-sd built in — no install needed)
- Google Cast device on the same Wi-Fi network
- Video must be a reachable URL (local file:// paths won't reach the device)

## License
MIT
