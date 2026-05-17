# ota-manager

Enterprise-grade Over-The-Air (OTA) update manager for Astro and static web projects.

## Features

- 🚀 **Multi-Provider Support**: Switch between GitHub and GitLab seamlessly.
- 🏗️ **Multi-Channel Deployment**: Manage 'training' and 'live' environments independently.
- 🔒 **Secure PAT Management**: Separate Read-only tokens (for APK) and Developer tokens (for deployment).
- 🛡️ **Pre-deployment Health Check**: Automatic version gap checking and token verification.
- 📦 **Smart ZIP Archiving**: POSIX-compliant compression for Android compatibility.

## Installation

```bash
npm install ota-manager --save-dev
```

## Quick Start

### 1. Initialize Configuration
```bash
npx ota-updates register gitlab
```
Follow the interactive prompts to set up your repository URL and Access Tokens.

### 2. Check Status
```bash
npx ota-updates status
```

### 3. Deploy Update
```bash
npx ota-updates training
```

## Configuration

The manager stores metadata in `ota-config.json` and sensitive tokens in your `.env` file.

```json
// ota-config.json
{
  "strategy": "gitlab",
  "configs": {
    "gitlab": {
      "repo": "https://gitlab.com/your-user/your-ota-repo",
      "branch": "main"
    }
  }
}
```

## License

MIT © First Ryan
