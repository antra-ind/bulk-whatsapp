# Bulk WhatsApp Sender — Chrome Extension

Send WhatsApp messages (with images, videos, files) to multiple numbers **without saving them as contacts**. Works directly through WhatsApp Web.

## Features

- **Send to unsaved numbers** — no need to add contacts
- **Bulk messaging** — paste contacts or import CSV
- **Attachments** — send images, videos, PDFs, docs (up to 16MB)
- **Custom variables** — use any CSV column as `{{variable}}` in your message
- **Message templates** — save & reuse frequent messages
- **Send history** — track all sent/failed messages
- **Stop button** — cancel mid-send during bulk operations

## Install

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder

## Usage

### 1. Open WhatsApp Web

Go to `web.whatsapp.com` and scan the QR code if needed.

### 2. Single message

Click the extension icon → **Single** tab → enter phone number, message, and optionally attach a file → **Send**.

### 3. Bulk messages

**Bulk** tab → add contacts (or import CSV) → write your message → **Preview** → **Send All**.

#### CSV format

```csv
phone,name,company,city
919876543210,John,Acme Corp,Mumbai
918765432109,Priya,TechCo,Bangalore
```

#### Variables

Use any CSV column as a variable in your message:

```
Hello {{name}} from {{company}} ({{city}}), reminder about tomorrow's meeting.
```

### 4. Templates

Save frequently used messages in the **Templates** tab for quick reuse.

## ⚠️ Warning — Account Safety

> **Do not send more than 250 messages per day.** Exceeding this limit may result in your WhatsApp account being **temporarily or permanently blocked** by WhatsApp. This tool is meant for personal/legitimate use only — misuse is your responsibility.

- WhatsApp actively monitors bulk messaging patterns
- Accounts flagged for spam may be banned without warning
- Use random delays (8+ seconds recommended) between messages
- Split large contact lists into batches across multiple days

## Important

- **Use responsibly** — WhatsApp may restrict accounts that send spam.
- Keep delay between messages ≥ 8 seconds to avoid rate-limiting.
- This tool is for **personal/legitimate use only**.
