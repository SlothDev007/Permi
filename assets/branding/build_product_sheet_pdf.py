from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "permi-product-sheet.pdf"
LOGO = ROOT / "permi-logo-v2.png"

INK = HexColor("#111827")
MUTED = HexColor("#526070")
NAVY = HexColor("#172034")
CYAN = HexColor("#35cdf6")
CYAN_DEEP = HexColor("#0676d8")
CYAN_LIGHT = HexColor("#7be3fb")
PINK = HexColor("#ff4bc8")
PINK_DEEP = HexColor("#cf148f")
PINK_LIGHT = HexColor("#ff8bdd")
SOFT = HexColor("#f4f8ff")
LINE = HexColor("#d9e2ef")
WHITE = HexColor("#ffffff")


def paragraph_style(name, size, leading, color=MUTED, bold=False):
    return ParagraphStyle(
        name=name,
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size,
        leading=leading,
        textColor=color,
        spaceAfter=0,
    )


BODY = paragraph_style("Body", 9.4, 12.4)
SMALL = paragraph_style("Small", 8.4, 11)
TITLE = paragraph_style("Title", 24, 27, NAVY, True)
HEADING = paragraph_style("Heading", 12.5, 15, NAVY, True)
EYEBROW = paragraph_style("Eyebrow", 8.5, 10, PINK_DEEP, True)


def draw_para(c, text, x, y, width, style):
    para = Paragraph(text, style)
    _, height = para.wrap(width, 10 * inch)
    para.drawOn(c, x, y - height)
    return y - height


def rounded_rect(c, x, y, width, height, fill, stroke=LINE, radius=8):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def blend_rect(c, x, y, width, height, left, right, steps=80):
    left_rgb = left.rgb()
    right_rgb = right.rgb()
    strip_w = width / steps
    for index in range(steps):
        ratio = index / max(steps - 1, 1)
        color = HexColor(
            "#%02x%02x%02x"
            % tuple(
                round((left_rgb[channel] + (right_rgb[channel] - left_rgb[channel]) * ratio) * 255)
                for channel in range(3)
            )
        )
        c.setFillColor(color)
        c.rect(x + index * strip_w, y, strip_w + 0.5, height, fill=1, stroke=0)


def draw_feature_panel(c, x, y, width, height, title, body, bullets=None):
    rounded_rect(c, x, y - height, width, height, WHITE)
    draw_para(c, title, x + 14, y - 16, width - 28, HEADING)
    cursor = y - 40
    if body:
        cursor = draw_para(c, body, x + 14, cursor, width - 28, BODY)
    if bullets:
        cursor -= 8
        for bullet in bullets:
            c.setFillColor(CYAN)
            c.circle(x + 19, cursor - 4, 3.2, fill=1, stroke=0)
            cursor = draw_para(c, bullet, x + 28, cursor + 1, width - 42, BODY) - 5


def draw_useful_panel(c, x, y, width, height):
    rounded_rect(c, x, y - height, width, height, WHITE)
    draw_para(c, "Useful for", x + 14, y - 16, width - 28, HEADING)
    items = [
        "Checking requested permissions and host access.",
        "Reviewing extension metadata before install.",
        "Keeping a local manifest copy for audit notes.",
    ]
    col_gap = 0.22 * inch
    col_w = (width - 28 - 2 * col_gap) / 3
    item_y = y - 58
    for index, item in enumerate(items):
        item_x = x + 14 + index * (col_w + col_gap)
        c.setFillColor(CYAN)
        c.circle(item_x + 4, item_y - 4, 3.2, fill=1, stroke=0)
        draw_para(c, item, item_x + 14, item_y + 2, col_w - 14, paragraph_style(f"Useful{index}", 8.6, 11.2, MUTED))


def draw_security_item(c, x, y, width, label, text, icon):
    c.setFillColor(CYAN)
    c.roundRect(x, y - 24, 24, 24, 6, fill=1, stroke=0)
    c.setFillColor(PINK)
    c.circle(x + 19, y - 5, 5, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(x + 12, y - 16, icon)
    draw_para(c, label, x + 33, y - 1, width - 33, SMALL.clone("SecurityHeading", textColor=NAVY, fontName="Helvetica-Bold"))
    draw_para(c, text, x + 33, y - 13, width - 33, SMALL)


def build():
    c = canvas.Canvas(str(OUT), pagesize=letter)
    width, height = letter
    margin = 0.55 * inch

    c.setFillColor(WHITE)
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(HexColor("#f8fbff"))
    c.rect(0, 0, width, height, fill=1, stroke=0)

    c.setFillColor(HexColor("#dff7ff"))
    c.circle(1.15 * inch, 10.25 * inch, 1.65 * inch, fill=1, stroke=0)
    c.setFillColor(HexColor("#ffe1f6"))
    c.circle(7.55 * inch, 10.55 * inch, 1.45 * inch, fill=1, stroke=0)

    logo_width = 3.15 * inch
    c.drawImage(str(LOGO), margin, height - margin - 1.58 * inch, width=logo_width, preserveAspectRatio=True, mask="auto")

    top_y = height - margin - 1.72 * inch
    draw_para(c, "Chrome extension manifest review", margin, top_y, 3.6 * inch, EYEBROW)
    title_y = draw_para(c, "Understand extension permissions before install.", margin, top_y - 16, 4.08 * inch, TITLE)
    draw_para(
        c,
        "Permi helps reviewers, builders, and cautious users inspect a Chrome Web Store extension's manifest file without installing the target extension first.",
        margin,
        title_y - 13,
        4.05 * inch,
        paragraph_style("Lead", 11.2, 15, MUTED),
    )

    card_x = 4.85 * inch
    card_y = height - margin - 0.35 * inch
    card_w = width - margin - card_x
    card_h = 3.05 * inch
    rounded_rect(c, card_x, card_y - card_h, card_w, card_h, HexColor("#effcff"), HexColor("#aeefff"))
    blend_rect(c, card_x + 1, card_y - 1.06 * inch, card_w - 2, 1.03 * inch, CYAN_LIGHT, PINK_LIGHT)
    draw_para(c, "What it does", card_x + 20, card_y - 17, card_w - 40, paragraph_style("CardHead", 12.5, 15, NAVY, True))
    draw_para(c, "Turns a Chrome Web Store URL or extension ID into a readable manifest JSON download.", card_x + 20, card_y - 39, card_w - 40, paragraph_style("CardBody", 8.7, 10.8, HexColor("#263244")))

    steps = [
        ("1", "Paste a listing", "Use a Chrome Web Store URL or a 32-character extension ID."),
        ("2", "Fetch from Google", "Permi requests the extension package from Google's Chrome update service."),
        ("3", "Extract locally", "The CRX is processed in memory, then only manifest.json is saved."),
    ]
    y = card_y - 1.24 * inch
    for number, label, text in steps:
        c.setFillColor(PINK)
        c.circle(card_x + 25, y - 8, 11, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawCentredString(card_x + 25, y - 11, number)
        draw_para(c, label, card_x + 46, y + 1, card_w - 60, SMALL.clone(f"Step{number}", textColor=NAVY, fontName="Helvetica-Bold"))
        draw_para(c, text, card_x + 46, y - 11, card_w - 60, SMALL)
        y -= 0.58 * inch

    panel_top = 6.56 * inch
    gap = 0.2 * inch
    panel_w = (width - 2 * margin - gap) / 2
    draw_feature_panel(
        c,
        margin,
        panel_top,
        panel_w,
        1.22 * inch,
        "Purpose",
        "Browser extension permissions can be difficult to understand from a store listing alone. Permi gives you the underlying manifest before installing.",
    )
    draw_feature_panel(
        c,
        margin + panel_w + gap,
        panel_top,
        panel_w,
        1.22 * inch,
        "Output",
        "Permi saves a formatted manifest.json file through Chrome's downloads flow, using a unique filename based on the target extension ID.",
    )
    draw_useful_panel(c, margin, panel_top - 1.38 * inch, width - 2 * margin, 1.25 * inch)

    sec_x = margin
    sec_y = 3.58 * inch
    sec_w = width - 2 * margin
    sec_h = 2.78 * inch
    rounded_rect(c, sec_x, sec_y - sec_h, sec_w, sec_h, WHITE, HexColor("#ffc8ec"))
    c.setFillColor(HexColor("#fff3fc"))
    c.roundRect(sec_x + 2, sec_y - sec_h + 2, sec_w - 4, sec_h - 4, 6, fill=1, stroke=0)
    draw_para(c, "Security and privacy posture", sec_x + 18, sec_y - 18, sec_w - 36, HEADING)

    col_w = (sec_w - 52) / 2
    left_x = sec_x + 18
    right_x = sec_x + 34 + col_w
    item_y = sec_y - 50
    draw_security_item(c, left_x, item_y, col_w, "Strict CSP", "Blocks loads by default, then allows only local assets and Google's CRX hosts.", "C")
    draw_security_item(c, right_x, item_y, col_w, "Local scripts only", "No remote code, inline scripts, eval, or third-party runtime dependencies.", "L")
    item_y -= 0.68 * inch
    draw_security_item(c, left_x, item_y, col_w, "Narrow permissions", "Uses downloads plus host access for Google's CRX update and delivery endpoints.", "P")
    draw_security_item(c, right_x, item_y, col_w, "In-memory processing", "Streams CRX bytes with limits, parses locally, and discards package bytes.", "I")
    item_y -= 0.68 * inch
    draw_security_item(c, left_x, item_y, col_w, "Input validation", "Accepts only Chrome Web Store URLs or valid 32-character extension IDs.", "V")
    draw_security_item(c, right_x, item_y, col_w, "No tracking or storage", "No analytics, cookies, accounts, ads IDs, or developer-controlled storage.", "N")

    c.setStrokeColor(LINE)
    c.line(margin, 0.63 * inch, width - margin, 0.63 * inch)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(margin, 0.43 * inch, "Permi - Manifest permissions, made readable.")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 8.2)
    c.drawRightString(width - margin, 0.43 * inch, "Created by CaidosCreek | Effective privacy date: April 28, 2026")

    c.save()


if __name__ == "__main__":
    build()
