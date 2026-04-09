# iina-plugin-googlecast

Cast videos playing in [IINA](https://iina.io) to any Google Cast device — including on restricted networks like hotels.

## Installation

In IINA: **Plugins → Plugin Manager → Install from GitHub**
```
ymedh/iinagooglecastplugin
```

## How It Works

1. Load a video in IINA
2. Open the **Google Cast** sidebar tab and click **Cast Current Video**
3. The plugin starts a local HTTP server and a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) to expose it publicly
4. A browser window opens with the video and the public URL
5. Use the browser's **Cast** toolbar button, or paste the public URL into [getstreaming.tv](https://getstreaming.tv) after pairing with your TV's code

## Works On

- Home/office networks (direct Cast via mDNS)
- Hotel/restricted networks (via automatic cloudflare tunnel — no account needed)
- Any network where the TV and Mac are isolated

## Requirements

- IINA 1.3.0+
- macOS
- A Chromium-based browser: Chrome, Chromium, Brave, Edge, or Chrome Canary
- Python 3 (built into macOS, or install from [python.org](https://python.org))
- [Homebrew](https://brew.sh) (for auto-installing `cloudflared` if not present)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `IINA_CAST_PORT` | `19421` | Override the local HTTP server port |

## Security

- No credentials, API keys, or secrets in code
- Cloudflare tunnel is ephemeral — new URL every session, auto-expires when IINA closes
- All file paths resolved dynamically at runtime

## License

MIT
