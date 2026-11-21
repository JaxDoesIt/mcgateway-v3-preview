# MCGateway V3 Design Preview

This is the **GitHub Pages-only** build of the current MCGateway V3 website. It is not the live MCGateway site.

- GitHub Pages publication source: **main / (root)**, configured in repository **Settings > Pages**.
- Expected address: https://jaxdoesit.github.io/mcgateway-v3-preview/
- The preview is intended for public visual testing for a short period and is marked `noindex`; this does not make the site private.
- The site is static: HTML, CSS, JS, and image assets only. The Cloudflare Worker is **not** included.
- Pages under `guides/` and the homepage use relative navigation, and no root-relative paths are required.
- Live statistics and bot listings request the **existing public** endpoints at `https://mcgateway.net/api/summary`, `/api/bots`, and `/api/statistics`. The production Worker permits these read-only responses to be fetched from `https://jaxdoesit.github.io` via CORS. These are the same API responses used by the production site's frontend; no private APIs are exposed.
- The preview **never fabricates bot availability or transfer totals**. Each endpoint retries an unsuccessful request and can display a previously validated snapshot from local storage, clearly labeled with its last verified time. If bot availability is not fresh, bot status becomes **Unverified** and copy/select actions are disabled. With no validated data, the page reports the connection failure instead of showing fake values.
- No future Island or game-mode pages are published.

## Creating the preview repository

1. Create **public** repository `mcgateway-v3-preview` under `JaxDoesIt` on GitHub.
2. Connect the ChatGPT GitHub app to that repository if it is restricted to selected repositories.
3. Upload/commit the contents of this root (not the folder itself) to `main`.
4. In the new repository, open **Settings > Pages**, choose **Deploy from a branch**, select `main` and `/(root)`, then Save.
5. Open https://jaxdoesit.github.io/mcgateway-v3-preview/ after GitHub reports its first deployment.

To replace the current design later, update the existing `JaxDoesIt/MCGateway-Website` source and have the normal production pipeline deploy after testing and explicit approval. Do not point production at this Pages repository or copy Pages-only API logic into production.
