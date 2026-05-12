# Embroiderly Logs

This is Cloudflare Worker that receives deployment webhooks from the [Embroiderly](https://github.com/embroidery-space/embroiderly) CI pipeline and publishes them to the [Embroiderly Logs](https://t.me/embroiderly_logs) Telegram channel.

After every successful Cloudflare deployment, the GitHub Actions workflow sends a `POST /` request to this Worker with deployment URLs and a commit link.
The Worker validates the shared secret and posts a message to the channel via a Telegram bot (using [grammY](https://grammy.dev/)).
