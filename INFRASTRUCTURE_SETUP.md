# 🛡️ OTA Infrastructure Setup Guide

This guide explains how to properly set up your repository for the **ota-manager** system. To ensure maximum security, we use a **Dual-Token System**.

## 🗝️ The Dual-Token System

1.  **Developer PAT (Private)**: 
    *   Used by developers/CI-CD to **Push** new updates.
    *   Requires **Write/Code Read & Write** access.
    *   Stored locally in `.env` (Never include this in your APK).
2.  **Public PAT (App-Facing)**:
    *   Used by the Mobile App (APK) to **Check & Download** updates.
    *   Requires **Read-only** access.
    *   Embedded in the App (Safe to be seen by the app).

---

## 🦊 GitLab Setup (Fine-grained Tokens)

1.  Go to your **GitLab Profile Settings** > **Access Tokens**.
2.  Click **Add new token** (Fine-grained token is recommended for specific projects).
3.  **Basic Info**: Name it `OTA-Public-Access`.
4.  **Group and project access**: Select **Only specific groups or projects** and find your OTA repository.
5.  **Permissions (Scopes)**:
    *   On the left menu, select **Repository**.
    *   For **Developer PAT**: Under **Code**, select **Push** from the dropdown.
    *   For **Public PAT**: Under **Code**, select **Read** from the dropdown.
    *   *Note*: If you encounter a 403 error during verification, also enable **API** > **Read** access on the left menu.
7.  Copy the token (starting with `glpat-`) and save it to your `.env` as `PUBLIC_GITLAB_OTA_PAT`.

---

## 🐙 GitHub Setup (Fine-grained Tokens)

1.  Go to your **GitHub Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens**.
2.  Click **Generate new token**.
3.  **Repository access**: Select **Only select repositories** and pick your OTA repo.
4.  **Permissions**:
    *   Under **Repository permissions**, find **Contents**.
    *   Select **Access: Read-only** for the Public token.
5.  Click **Generate token**.
6.  Copy the token (starting with `github_pat_`) and save it to your `.env` as `PUBLIC_GITHUB_OTA_PAT`.

---

## 🚀 Environment Configuration

Once you have your tokens, run the following command to register them:

```bash
npm run ota-updates register <id>
```

Replace `<id>` with `github` or `gitlab`. The manager will guide you to input your repository URL and both PATs.

---

> [!IMPORTANT]
> **NEVER** give the Public PAT 'Write' access. This ensures that even if someone extracts the token from your APK, they cannot modify or delete your releases.
