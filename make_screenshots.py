#!/usr/bin/env python3
"""Generate Chrome Web Store screenshots (1280x800, 24-bit PNG no alpha)."""

from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(OUT, exist_ok=True)

W, H = 1280, 800

# Colors
BG = (17, 27, 33)          # WhatsApp dark bg
PANEL = (32, 44, 51)       # Side panel
GREEN = (0, 168, 132)      # WhatsApp green
WHITE = (255, 255, 255)
GRAY = (134, 150, 160)
LIGHT = (233, 237, 239)
POPUP_BG = (255, 255, 255)
ACCENT = (37, 211, 102)    # WhatsApp accent green
DARK_TEXT = (34, 34, 34)
ORANGE = (255, 152, 0)

def font(size):
    return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)

def bold(size):
    return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size, index=1)

def draw_rounded_rect(draw, xy, fill, radius=12):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill)

def draw_wa_bg(draw):
    """Draw a simplified WhatsApp Web background."""
    draw.rectangle([0, 0, W, H], fill=BG)
    # Top bar
    draw.rectangle([0, 0, W, 60], fill=GREEN)
    draw.text((20, 16), "WhatsApp Web", fill=WHITE, font=bold(24))
    # Side panel hint
    draw.rectangle([0, 60, 340, H], fill=PANEL)
    # Chat area
    draw.rectangle([340, 60, W, H], fill=(14, 20, 25))
    # Fake chat items
    for i in range(6):
        y = 80 + i * 80
        draw.rounded_rectangle([10, y, 330, y+65], radius=8, fill=(42, 57, 66))
        draw.text((70, y+10), f"Contact {i+1}", fill=WHITE, font=font(16))
        draw.text((70, y+32), "Last message...", fill=GRAY, font=font(13))
        draw.ellipse([18, y+8, 58, y+48], fill=GRAY)

def draw_popup(draw, x, y, w, h, title, content_fn):
    """Draw a Chrome extension popup overlay."""
    # Shadow
    draw.rounded_rectangle([x+4, y+4, x+w+4, y+h+4], radius=12, fill=(0, 0, 0, 80))
    # Popup body
    draw.rounded_rectangle([x, y, x+w, y+h], radius=12, fill=POPUP_BG)
    # Header area
    draw.rounded_rectangle([x, y, x+w, y+60], radius=12, fill=GREEN)
    draw.rectangle([x, y+30, x+w, y+60], fill=GREEN)
    # Logo circle
    draw.ellipse([x+15, y+12, x+48, y+45], fill=WHITE)
    draw.text((x+23, y+16), "W", fill=GREEN, font=bold(18))
    draw.text((x+55, y+10), "Bulk WhatsApp Sender", fill=WHITE, font=bold(18))
    draw.text((x+55, y+34), title, fill=(200, 255, 220), font=font(12))
    content_fn(draw, x, y)

def draw_badge(draw, x, y, text, color=ACCENT):
    tw = len(text) * 8 + 16
    draw.rounded_rectangle([x, y, x+tw, y+26], radius=13, fill=color)
    draw.text((x+8, y+5), text, fill=WHITE, font=bold(13))


# ═══════════════════════════════════════════════════════════════
# Screenshot 1: Single message tab
# ═══════════════════════════════════════════════════════════════
def screenshot1():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw_wa_bg(draw)

    def content(draw, x, y):
        cy = y + 75
        # Tab bar
        tabs = ["Single", "Bulk", "Templates", "History"]
        for i, t in enumerate(tabs):
            tx = x + 10 + i * 95
            c = GREEN if i == 0 else (220, 220, 220)
            tc = WHITE if i == 0 else GRAY
            draw.rounded_rectangle([tx, cy, tx+85, cy+30], radius=6, fill=c)
            draw.text((tx+12, cy+7), t, fill=tc, font=bold(13))
        cy += 45
        # Phone field
        draw.text((x+15, cy), "Phone Number", fill=DARK_TEXT, font=bold(14))
        cy += 22
        draw.rounded_rectangle([x+15, cy, x+365, cy+36], radius=6, fill=(245, 245, 245), outline=(200,200,200))
        draw.text((x+25, cy+9), "+91 98765 43210", fill=GRAY, font=font(14))
        cy += 50
        # Message field
        draw.text((x+15, cy), "Message", fill=DARK_TEXT, font=bold(14))
        cy += 22
        draw.rounded_rectangle([x+15, cy, x+365, cy+80], radius=6, fill=(245, 245, 245), outline=(200,200,200))
        draw.text((x+25, cy+10), "Hello! This is a test message", fill=DARK_TEXT, font=font(14))
        draw.text((x+25, cy+30), "from Bulk WhatsApp Sender.", fill=DARK_TEXT, font=font(14))
        cy += 95
        # Send button
        draw.rounded_rectangle([x+15, cy, x+365, cy+40], radius=8, fill=GREEN)
        draw.text((x+130, cy+10), "Send Message", fill=WHITE, font=bold(16))

    draw_popup(draw, 440, 80, 380, 430, "Send messages — no contact saving", content)

    # Feature callouts
    draw.rounded_rectangle([860, 120, 1240, 180], radius=10, fill=(42, 57, 66))
    draw.text((880, 130), "✓ No need to save contacts", fill=ACCENT, font=bold(18))
    draw.text((880, 155), "Send to any number directly", fill=GRAY, font=font(14))

    draw.rounded_rectangle([860, 200, 1240, 260], radius=10, fill=(42, 57, 66))
    draw.text((880, 210), "✓ Works on Chrome & Edge", fill=ACCENT, font=bold(18))
    draw.text((880, 235), "No setup or login required", fill=GRAY, font=font(14))

    draw.rounded_rectangle([860, 280, 1240, 340], radius=10, fill=(42, 57, 66))
    draw.text((880, 290), "✓ 100% Free & Unlimited", fill=ACCENT, font=bold(18))
    draw.text((880, 315), "Open source on GitHub", fill=GRAY, font=font(14))

    img.save(os.path.join(OUT, "1-single-message.png"), "PNG")
    print("Created: 1-single-message.png")


# ═══════════════════════════════════════════════════════════════
# Screenshot 2: Bulk message tab with CSV
# ═══════════════════════════════════════════════════════════════
def screenshot2():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw_wa_bg(draw)

    def content(draw, x, y):
        cy = y + 75
        tabs = ["Single", "Bulk", "Templates", "History"]
        for i, t in enumerate(tabs):
            tx = x + 10 + i * 95
            c = GREEN if i == 1 else (220, 220, 220)
            tc = WHITE if i == 1 else GRAY
            draw.rounded_rectangle([tx, cy, tx+85, cy+30], radius=6, fill=c)
            draw.text((tx+12, cy+7), t, fill=tc, font=bold(13))
        cy += 45
        # Contacts
        draw.text((x+15, cy), "Contacts", fill=DARK_TEXT, font=bold(14))
        cy += 22
        draw.rounded_rectangle([x+15, cy, x+365, cy+70], radius=6, fill=(245, 245, 245), outline=(200,200,200))
        draw.text((x+25, cy+8), "919876543210,John,Acme", fill=DARK_TEXT, font=font(12))
        draw.text((x+25, cy+26), "918765432109,Priya,TechCo", fill=DARK_TEXT, font=font(12))
        draw.text((x+25, cy+44), "917654321098,Alex,StartupX", fill=DARK_TEXT, font=font(12))
        cy += 80
        # Headers
        draw.text((x+15, cy), "Column Headers", fill=DARK_TEXT, font=bold(14))
        cy += 22
        draw.rounded_rectangle([x+15, cy, x+365, cy+32], radius=6, fill=(245, 245, 245), outline=(200,200,200))
        draw.text((x+25, cy+8), "phone,name,company", fill=DARK_TEXT, font=font(13))
        cy += 42
        # Message with variables
        draw.text((x+15, cy), "Message", fill=DARK_TEXT, font=bold(14))
        cy += 22
        draw.rounded_rectangle([x+15, cy, x+365, cy+55], radius=6, fill=(245, 245, 245), outline=(200,200,200))
        draw.text((x+25, cy+8), "Hello {{name}} from {{company}},", fill=DARK_TEXT, font=font(13))
        draw.text((x+25, cy+28), "this is a reminder about...", fill=DARK_TEXT, font=font(13))
        cy += 68
        # Delay
        draw.text((x+15, cy), "Delay: 5s to 12s", fill=GRAY, font=font(12))
        cy += 25
        # Send button
        draw.rounded_rectangle([x+15, cy, x+365, cy+40], radius=8, fill=GREEN)
        draw.text((x+100, cy+10), "Send to 3 Contacts", fill=WHITE, font=bold(16))

    draw_popup(draw, 440, 50, 380, 530, "Send personalized bulk messages", content)

    # Highlights
    draw.rounded_rectangle([860, 100, 1250, 190], radius=10, fill=(42, 57, 66))
    draw.text((880, 112), "📋 CSV Import Support", fill=WHITE, font=bold(20))
    draw.text((880, 140), "Import contacts from CSV files", fill=GRAY, font=font(14))
    draw.text((880, 160), "with custom columns", fill=GRAY, font=font(14))

    draw.rounded_rectangle([860, 210, 1250, 300], radius=10, fill=(42, 57, 66))
    draw.text((880, 222), "✨ Personalized Messages", fill=WHITE, font=bold(20))
    draw.text((880, 250), "Use {{name}}, {{company}} etc.", fill=GRAY, font=font(14))
    draw.text((880, 270), "for personalization", fill=GRAY, font=font(14))

    draw.rounded_rectangle([860, 320, 1250, 410], radius=10, fill=(42, 57, 66))
    draw.text((880, 332), "⏱ Smart Random Delays", fill=WHITE, font=bold(20))
    draw.text((880, 360), "Random delay between messages", fill=GRAY, font=font(14))
    draw.text((880, 380), "to avoid WhatsApp bans", fill=GRAY, font=font(14))

    img.save(os.path.join(OUT, "2-bulk-message.png"), "PNG")
    print("Created: 2-bulk-message.png")


# ═══════════════════════════════════════════════════════════════
# Screenshot 3: Templates tab
# ═══════════════════════════════════════════════════════════════
def screenshot3():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw_wa_bg(draw)

    def content(draw, x, y):
        cy = y + 75
        tabs = ["Single", "Bulk", "Templates", "History"]
        for i, t in enumerate(tabs):
            tx = x + 10 + i * 95
            c = GREEN if i == 2 else (220, 220, 220)
            tc = WHITE if i == 2 else GRAY
            draw.rounded_rectangle([tx, cy, tx+85, cy+30], radius=6, fill=c)
            draw.text((tx+12, cy+7), t, fill=tc, font=bold(13))
        cy += 50

        # Template cards
        templates = [
            ("Welcome Message", "Hello {{name}}! Welcome to our community..."),
            ("Meeting Reminder", "Hi {{name}}, reminder about your meeting..."),
            ("Follow Up", "Dear {{name}}, just following up on our..."),
            ("Event Invite", "You're invited! Hi {{name}}, join us for..."),
        ]
        for title, body in templates:
            draw.rounded_rectangle([x+15, cy, x+365, cy+65], radius=8, fill=(245, 250, 255), outline=(200,220,240))
            draw.text((x+25, cy+8), title, fill=DARK_TEXT, font=bold(14))
            draw.text((x+25, cy+30), body[:40] + "...", fill=GRAY, font=font(12))
            # Use button
            draw.rounded_rectangle([x+300, cy+8, x+355, cy+30], radius=5, fill=GREEN)
            draw.text((x+313, cy+12), "Use", fill=WHITE, font=bold(11))
            cy += 75

        # Save template
        draw.rounded_rectangle([x+15, cy+10, x+365, cy+48], radius=8, fill=(245, 245, 245), outline=GREEN)
        draw.text((x+110, cy+20), "+ Save New Template", fill=GREEN, font=bold(14))

    draw_popup(draw, 440, 60, 380, 480, "Save & reuse message templates", content)

    draw.rounded_rectangle([860, 140, 1250, 230], radius=10, fill=(42, 57, 66))
    draw.text((880, 152), "💾 Save Templates", fill=WHITE, font=bold(20))
    draw.text((880, 180), "Create reusable message templates", fill=GRAY, font=font(14))
    draw.text((880, 200), "with variable placeholders", fill=GRAY, font=font(14))

    draw.rounded_rectangle([860, 250, 1250, 320], radius=10, fill=(42, 57, 66))
    draw.text((880, 262), "⚡ One-Click Apply", fill=WHITE, font=bold(20))
    draw.text((880, 290), "Apply any template instantly", fill=GRAY, font=font(14))

    img.save(os.path.join(OUT, "3-templates.png"), "PNG")
    print("Created: 3-templates.png")


# ═══════════════════════════════════════════════════════════════
# Screenshot 4: Sending in progress with log
# ═══════════════════════════════════════════════════════════════
def screenshot4():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw_wa_bg(draw)

    def content(draw, x, y):
        cy = y + 75
        # Progress header
        draw.text((x+15, cy), "Sending Messages...", fill=DARK_TEXT, font=bold(18))
        cy += 30
        # Progress bar bg
        draw.rounded_rectangle([x+15, cy, x+365, cy+24], radius=12, fill=(230, 230, 230))
        # Progress bar fill (60%)
        draw.rounded_rectangle([x+15, cy, x+225, cy+24], radius=12, fill=GREEN)
        draw.text((x+100, cy+4), "3 / 5", fill=WHITE, font=bold(13))
        cy += 40
        # Log entries
        logs = [
            ("10:23:15", "919876543210", "✓ Sent", ACCENT),
            ("10:23:28", "918765432109", "✓ Sent", ACCENT),
            ("10:23:41", "917654321098", "✓ Sent", ACCENT),
            ("10:23:55", "916543210987", "⏳ Sending...", ORANGE),
            ("10:24:08", "915432109876", "⏳ Waiting", GRAY),
        ]
        for time, num, status, color in logs:
            draw.rounded_rectangle([x+15, cy, x+365, cy+36], radius=6, fill=(248, 248, 248))
            draw.text((x+25, cy+9), time, fill=GRAY, font=font(11))
            draw.text((x+100, cy+9), num, fill=DARK_TEXT, font=font(13))
            draw.text((x+280, cy+9), status, fill=color, font=bold(12))
            cy += 42
        cy += 10
        # Warning box
        draw.rounded_rectangle([x+15, cy, x+365, cy+45], radius=8, fill=(255, 243, 224), outline=ORANGE)
        draw.text((x+25, cy+6), "⚠ Safety Tips", fill=ORANGE, font=bold(13))
        draw.text((x+25, cy+24), "Don't send more than 250 msgs/day", fill=(150, 100, 50), font=font(11))

    draw_popup(draw, 440, 60, 380, 470, "Real-time sending progress", content)

    draw.rounded_rectangle([860, 140, 1250, 230], radius=10, fill=(42, 57, 66))
    draw.text((880, 152), "📊 Live Progress Tracking", fill=WHITE, font=bold(20))
    draw.text((880, 180), "See each message status in", fill=GRAY, font=font(14))
    draw.text((880, 200), "real-time with timestamps", fill=GRAY, font=font(14))

    draw.rounded_rectangle([860, 250, 1250, 340], radius=10, fill=(42, 57, 66))
    draw.text((880, 262), "🔒 Anti-Ban Protection", fill=WHITE, font=bold(20))
    draw.text((880, 290), "Random delays + daily limits", fill=GRAY, font=font(14))
    draw.text((880, 310), "keep your account safe", fill=GRAY, font=font(14))

    img.save(os.path.join(OUT, "4-sending-progress.png"), "PNG")
    print("Created: 4-sending-progress.png")


# ═══════════════════════════════════════════════════════════════
# Screenshot 5: Feature overview / hero
# ═══════════════════════════════════════════════════════════════
def screenshot5():
    img = Image.new("RGB", (W, H), (15, 22, 28))
    draw = ImageDraw.Draw(img)

    # Large centered title
    draw.text((W//2 - 280, 60), "Bulk WhatsApp Sender", fill=WHITE, font=bold(48))
    draw.text((W//2 - 240, 120), "Free • Open Source • No Contact Saving", fill=ACCENT, font=bold(22))

    # Feature grid (2x3)
    features = [
        ("📱", "Send Without\nSaving Contacts", "Message any number\ndirectly via WhatsApp Web"),
        ("📋", "CSV Import\n& Variables", "Import contacts and\npersonalize messages"),
        ("⏱", "Smart Delays\n& Anti-Ban", "Random delays to\nkeep your account safe"),
        ("💾", "Message\nTemplates", "Save and reuse\nyour best messages"),
        ("📊", "Live Progress\nTracking", "Real-time status\nfor each message"),
        ("🌐", "Chrome &\nEdge Support", "Works on all\nChromium browsers"),
    ]

    cols = 3
    cw, ch = 350, 200
    sx = (W - cols * cw) // 2
    sy = 200

    for i, (icon, title, desc) in enumerate(features):
        col = i % cols
        row = i // cols
        fx = sx + col * (cw + 20)
        fy = sy + row * (ch + 20)

        draw.rounded_rectangle([fx, fy, fx+cw, fy+ch], radius=14, fill=(32, 44, 51))
        draw.text((fx + 20, fy + 20), icon, fill=WHITE, font=font(36))
        lines = title.split("\n")
        for li, line in enumerate(lines):
            draw.text((fx + 20, fy + 65 + li * 22), line, fill=WHITE, font=bold(18))
        dlines = desc.split("\n")
        for li, line in enumerate(dlines):
            draw.text((fx + 20, fy + 120 + li * 18), line, fill=GRAY, font=font(14))

    # Footer
    draw.text((W//2 - 120, H - 60), "github.com/antra-ind", fill=GRAY, font=font(16))
    draw.text((W//2 - 80, H - 35), "v1.1.0 • Apache 2.0", fill=(80, 100, 110), font=font(13))

    img.save(os.path.join(OUT, "5-feature-overview.png"), "PNG")
    print("Created: 5-feature-overview.png")


if __name__ == "__main__":
    screenshot1()
    screenshot2()
    screenshot3()
    screenshot4()
    screenshot5()
    print(f"\nAll screenshots saved to: {OUT}/")
