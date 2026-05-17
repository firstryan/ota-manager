# 📦 ota-manager

<div align="center">
  <h3>Enterprise-Grade Over-The-Air (OTA) Update Manager for Astro, Capacitor, and Static Web Apps</h3>
  <p>Seamlessly deploy live updates to mobile WebViews and web apps without going through App Store or Play Store reviews.</p>
</div>

---

## ✨ Why `ota-manager`?

Modern mobile hybrid apps (built with Astro, Vite, or Capacitor) require a robust, foolproof update pipeline. `ota-manager` provides an end-to-end automated deployment system with built-in safeguards against common deployment pitfalls like broken asset paths, zip bombs, and token leaks.

### 🌟 Key Features

*   🚀 **Universal & Project-Agnostic**: Dynamically detects `process.cwd()` to integrate flawlessly into any Astro, Vite, Next.js, or static web project.
*   🔄 **Flexible CLI Shorthands**: Supports both `npx ota-manager` and `npx ota-updates`. Features lightning-fast shorthands like `npx ota-manager -d training` and `-d live`.
*   🔀 **Multi-Provider & Multi-Channel Routing**: Built-in support for GitHub and GitLab strategies. Configure independent target repositories and branches for `training` vs `live` environments.
*   🛡️ **Size Guardian Protocol**: Pre-flight audit of your `dist/` directory and generated ZIP archive to prevent Zip Bombs (>50MB threshold protection).
*   💥 **Tsar Bomba Path Cleanse (`flatten-dist.cjs`)**: Post-build normalization of absolute asset paths (`/assets/`) to relative paths (`./assets/`) to guarantee flawless Capacitor WebView navigation.
*   🙈 **API Route Protection**: Automatically isolates and hides `/src/pages/api` during static export/build to prevent build failures, then restores them seamlessly.
*   🔐 **Security Auditor (`ota-security.js`)**: Automated inspection of Personal Access Tokens (PAT) to prevent token leaks or overly broad repository access.
*   📡 **E2E Connection Simulation**: Built-in `test` command to simulate push and read capabilities against your Git provider before executing actual deployments.

---

## 📦 Installation

Install `ota-manager` as a development dependency in your project:

```bash
npm install ota-manager --save-dev
```

---

## 🚀 Quick Start Guide

### 1. Initialize Infrastructure
Register your Git provider (GitHub or GitLab) to initialize `ota-config.json` and `.env` credentials:
```bash
npx ota-manager register github
# or: npx ota-manager register gitlab
```
*Follow the interactive prompts to enter your repository URL and Access Tokens.*

### 2. Verify Connection & Security
Run an end-to-end simulation to ensure your tokens and repository permissions are perfectly configured:
```bash
npx ota-manager test
```

### 3. Check Version Gap
Compare your local `.env` app version against the remote release manifest:
```bash
npx ota-manager status
```

### 4. Deploy Update
Deploy your build to the `training` or `live` channel with automated pre-flight checks, path cleansing, and size auditing:
```bash
# Deploy to Training Channel
npx ota-manager deploy training
# Shorthand alias:
npx ota-manager -d training

# Deploy to Live (Production) Channel
npx ota-manager deploy live
# Shorthand alias:
npx ota-manager -d live
```

---

## ⚙️ Advanced Configuration

`ota-manager` stores its active strategy in `ota-config.json` and sensitive tokens in your `.env` file.

### Flexible Channel Routing (`ota-config.json`)
You can configure different branches or even different repositories for your `training` and `live` channels:

```json
{
  "strategy": "github",
  "github": {
    "repo": "https://github.com/your-org/your-ota-repo",
    "branch": "main",
    "channels": {
      "training": {
        "branch": "main"
      },
      "live": {
        "branch": "ota-live"
      }
    }
  }
}
```

### Environment Variables (`.env`)
The manager automatically updates your versioning and OTA target URLs during deployment:
```env
GITHUB_DEV_PAT="ghp_your_developer_token_here"
PUBLIC_APP_VERSION_ANDROID=1.0.4
PUBLIC_APP_VERSION_IOS=1.0.4
PUBLIC_OTA_UPDATE_URL=https://raw.githubusercontent.com/your-org/your-ota-repo/main/manifest.json
```

---

## 🛡️ Built-in Safeguards Architecture

```text
┌──────────────────────────────────────────────────────────┐
│                   npx ota-manager -d live                │
└─────────────────────────────┬────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────┐
│ 1. Pre-Flight Check: ota-version & verify-dist           │
└─────────────────────────────┬────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────┐
│ 2. API Route Protection: Hides /src/pages/api            │
└─────────────────────────────┬────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────┐
│ 3. Build & Tsar Bomba Cleanse: Normalizes /assets/ paths │
└─────────────────────────────┬────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────┐
│ 4. Size Guardian Audit: Validates dist/ & ZIP < 50MB     │
└─────────────────────────────┬────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────┐
│ 5. Remote Push & Manifest Update (GitHub / GitLab)       │
└──────────────────────────────────────────────────────────┘
```

---

## 📄 License

MIT © [First Ryan](https://github.com/firstryan)
