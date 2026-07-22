"""
Generate the colleague-facing OCHA QuickVid install guide as a one-file PDF.

Modelled on the DataViz plugin's guide builder
(ocha_dataviz_tool/tools/install-guide-source/build.py): a PDF opens
straight from anywhere with the screenshots embedded — no markdown rendering,
no sibling image folders.

Output:  distribution/OCHA_QuickVid_Install_Guide.pdf
Usage:   python3 tools/install-guide-source/build.py

To change the text, edit this script and re-run. Only needs re-running when
install STEPS change — routine version bumps don't touch it.
"""

import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import cm
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, KeepTogether, ListFlowable,
    ListItem, PageBreak
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── OCHA brand font (Roboto), falling back to Helvetica ──
ROBOTO_DIR = "/Library/Fonts/Roboto"
try:
    pdfmetrics.registerFont(TTFont("Roboto",            f"{ROBOTO_DIR}/Roboto-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("Roboto-Bold",       f"{ROBOTO_DIR}/Roboto-Bold.ttf"))
    pdfmetrics.registerFont(TTFont("Roboto-Italic",     f"{ROBOTO_DIR}/Roboto-Italic.ttf"))
    pdfmetrics.registerFont(TTFont("Roboto-BoldItalic", f"{ROBOTO_DIR}/Roboto-BoldItalic.ttf"))
    pdfmetrics.registerFontFamily("Roboto", normal="Roboto", bold="Roboto-Bold",
                                  italic="Roboto-Italic", boldItalic="Roboto-BoldItalic")
    BODY_FONT, BOLD_FONT = "Roboto", "Roboto-Bold"
except Exception as font_err:
    print(f"WARN: Roboto registration failed ({font_err}); falling back to Helvetica.")
    BODY_FONT, BOLD_FONT = "Helvetica", "Helvetica-Bold"

OCHA_BLUE = HexColor("#009EDB")
OCHA_DARK = HexColor("#1A1A1A")
OCHA_GREY = HexColor("#555555")

HERE   = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.normpath(os.path.join(HERE, "..", "..", "distribution", "OCHA_QuickVid_Install_Guide.pdf"))
IMG_STEP1  = os.path.join(HERE, "images", "install-aescripts-step1.jpg")
IMG_STEP2  = os.path.join(HERE, "images", "install-aescripts-step2.jpg")
IMG_NOCOMP = os.path.join(HERE, "images", "no-compatible-dialog.jpg")
LOGO_PNG   = os.path.join(HERE, "images", "ocha-logo-horizontal-blue-simple.png")

styles = getSampleStyleSheet()

title_style = ParagraphStyle("Title", parent=styles["Title"], fontName=BOLD_FONT,
    fontSize=22, textColor=OCHA_BLUE, spaceAfter=2, alignment=TA_LEFT, leading=26)
intro_style = ParagraphStyle("Intro", parent=styles["Normal"], fontName=BODY_FONT,
    fontSize=11, textColor=OCHA_DARK, leading=15, alignment=TA_LEFT, spaceAfter=18,
    spaceBefore=4, backColor=HexColor("#F0F8FC"), leftIndent=12, rightIndent=12,
    borderPadding=10)
h2_style = ParagraphStyle("H2", parent=styles["Heading2"], fontName=BOLD_FONT,
    fontSize=15, textColor=OCHA_BLUE, spaceBefore=14, spaceAfter=6, leading=18)
h3_style = ParagraphStyle("H3", parent=styles["Heading3"], fontName=BOLD_FONT,
    fontSize=11, textColor=OCHA_DARK, spaceBefore=10, spaceAfter=2, leading=14)
body_style = ParagraphStyle("Body", parent=styles["BodyText"], fontName=BODY_FONT,
    fontSize=10.5, textColor=OCHA_DARK, leading=14.5, alignment=TA_LEFT, spaceAfter=6)
small_style = ParagraphStyle("Small", parent=styles["Normal"], fontName=BODY_FONT,
    fontSize=9, textColor=OCHA_GREY, leading=12, spaceAfter=4)
# The one warning that saves a support email: the installer's false
# "not compatible" dialog. Boxed so it can't be skim-read past.
warn_style = ParagraphStyle("Warn", parent=body_style, backColor=HexColor("#FFF6E5"),
    leftIndent=12, rightIndent=12, borderPadding=10, spaceBefore=6, spaceAfter=8)


def numbered(steps):
    items = [ListItem(Paragraph(s, body_style), leftIndent=18) for s in steps]
    return ListFlowable(items, bulletType="1", leftIndent=18,
                        bulletFontName=BOLD_FONT, bulletFontSize=10.5)


def caption(text):
    return Paragraph(f"<i>{text}</i>", ParagraphStyle("cap", parent=small_style,
        alignment=TA_LEFT, spaceBefore=2, spaceAfter=10, leading=11))


def fitted_image(path, max_width_cm=7.5):
    from PIL import Image as PILImage
    pil = PILImage.open(path)
    iw, ih = pil.size
    target_w = max_width_cm * cm
    return Image(path, width=target_w, height=target_w * ih / iw)


def _draw_footer(canvas, doc):
    canvas.saveState()
    page_w, _ = A4
    left, right = 2.0 * cm, page_w - 2.0 * cm
    rule_y = 2.4 * cm
    canvas.setStrokeColor(HexColor("#CCCCCC"))
    canvas.setLineWidth(0.5)
    canvas.line(left, rule_y, right, rule_y)
    try:
        from PIL import Image as PILImage
        pil = PILImage.open(LOGO_PNG)
        iw, ih = pil.size
        logo_w = 3.4 * cm
        canvas.drawImage(LOGO_PNG, left, rule_y - logo_w * ih / iw - 0.2 * cm,
                         width=logo_w, height=logo_w * ih / iw,
                         preserveAspectRatio=True, mask="auto")
    except Exception:
        pass
    canvas.setFont(BODY_FONT, 8)
    canvas.setFillColor(HexColor("#888888"))
    canvas.drawRightString(right, rule_y - 0.55 * cm, "OCHA Brand and Design Unit. 2026")
    canvas.restoreState()


def build():
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=2.0 * cm, rightMargin=2.0 * cm,
        topMargin=1.8 * cm, bottomMargin=3.8 * cm,
        title="OCHA QuickVid — Install Guide",
        author="OCHA Brand and Design Unit",
    )
    story = []

    story.append(Paragraph("OCHA QuickVid", title_style))
    story.append(Paragraph("Install guide for Adobe Premiere Pro",
        ParagraphStyle("subtitle", parent=body_style, fontSize=12,
                       textColor=OCHA_GREY, spaceAfter=14, leading=15)))
    story.append(Paragraph(
        "The OCHA branding elements &mdash; lower third, location, OCHA logo, "
        "ending, on-screen text, readability gradient &mdash; dropped straight "
        "onto your Premiere timeline, matched to the sequence format. "
        "<b>Install once via the steps below.</b> From then on the panel "
        "updates itself &mdash; when a new version is out you'll see "
        "&ldquo;Update now&rdquo; in a banner at the top of the panel.",
        intro_style))

    # ── macOS ────────────────────────────────────────────
    story.append(Paragraph("macOS", h2_style))
    story.append(numbered([
        "Quit Premiere Pro (Cmd&nbsp;Q &mdash; fully quit).",
        "Download the free <b>ZXP/UXP Installer</b> from "
        "<font color='#009EDB'>aescripts.com/learn/zxp-installer</font>.",
        "Drag <b>ocha-quickvid-panel.zxp</b> onto the installer window.",
        "Open Premiere Pro <font face='Helvetica'>&rarr;</font> "
        "<b>Window <font face='Helvetica'>&rarr;</font> Extensions "
        "<font face='Helvetica'>&rarr;</font> OCHA QuickVid</b>.",
    ]))

    # ── Windows ──────────────────────────────────────────
    story.append(Paragraph("Windows", h2_style))

    story.append(Paragraph("1. Run windows-setup.bat (one-time)", h3_style))
    story.append(Paragraph(
        "Double-click <b>windows-setup.bat</b> in this folder, click "
        "&ldquo;Yes&rdquo; when Windows asks, press any key. This tells "
        "Premiere to load our self-signed panel. Once per computer.",
        body_style))

    story.append(Paragraph("2. Install ZXP/UXP Installer", h3_style))
    story.append(Paragraph(
        "Get it free from <font color='#009EDB'>aescripts.com/learn/zxp-installer</font>. "
        "When the setup wizard asks, install <b>only the ZXP/UXP Installer</b> "
        "&mdash; leave the manager app unchecked:", body_style))
    story.append(KeepTogether([
        fitted_image(IMG_STEP1, max_width_cm=7.5),
        caption("Uncheck &ldquo;manager app&rdquo;, keep &ldquo;ZXP/UXP "
                "Installer&rdquo; checked."),
    ]))

    story.append(Paragraph("3. Confirm &ldquo;Install for current user only&rdquo;", h3_style))
    story.append(Paragraph(
        "Open the ZXP/UXP Installer, click the <b>gear icon</b> top-left, and "
        "make sure <b>&ldquo;Install for current user only (when "
        "possible)&rdquo;</b> is <b>checked</b>. Click <b>OK</b>. (This is what "
        "lets the panel update itself later.)", body_style))
    story.append(KeepTogether([
        fitted_image(IMG_STEP2, max_width_cm=7.5),
        caption("The gear icon and the &ldquo;Install for current user "
                "only&rdquo; checkbox."),
    ]))

    story.append(Paragraph("4. Add the ZXP &mdash; and ignore the compatibility warning", h3_style))
    story.append(Paragraph(
        "Drag <b>ocha-quickvid-panel.zxp</b> onto the ZXP/UXP Installer window "
        "<i>or</i> use <b>File <font face='Helvetica'>&rarr;</font> Open</b> in "
        "the installer's menu and pick the file. The installer may then claim "
        "no compatible application was found:", body_style))
    story.append(KeepTogether([
        fitted_image(IMG_NOCOMP, max_width_cm=9.5),
        caption("This warning is wrong &mdash; ignore it."),
    ]))
    story.append(Paragraph(
        "<b>The warning is incorrect &mdash; OCHA QuickVid works fine with "
        "your Premiere Pro.</b> The installer just fails to detect Premiere on "
        "some Windows machines. Click <b>Install</b> and let it finish.",
        warn_style))

    story.append(Paragraph("5. Open the panel", h3_style))
    story.append(Paragraph(
        "Open Premiere Pro <font face='Helvetica'>&rarr;</font> <b>Window "
        "<font face='Helvetica'>&rarr;</font> Extensions "
        "<font face='Helvetica'>&rarr;</font> OCHA QuickVid</b>.", body_style))

    # ── Tail sections ────────────────────────────────────
    story.append(Spacer(1, 16))
    story.append(Paragraph("Updates", h2_style))
    story.append(Paragraph(
        "When a new version is out, a banner appears at the top of the panel: "
        "<b>&ldquo;New version vX.Y.Z &mdash; Update now&rdquo;</b>. Click it. "
        "The new build downloads, then the banner says <b>&ldquo;quit Premiere "
        "to finish installing&rdquo;</b>. Quit Premiere fully, wait a few "
        "seconds, reopen &mdash; the panel confirms <b>&ldquo;Updated to "
        "vX.Y.Z <font face='Helvetica'>&#10003;</font>&rdquo;</b>.",
        body_style))

    story.append(PageBreak())          # keep the troubleshooting tail on its own page
    story.append(Paragraph("If auto-update doesn't work", h2_style))
    story.append(Paragraph(
        "Rare, but if the update doesn't land, download the latest "
        "<b>ocha-quickvid-panel.zxp</b> from this folder and drag it onto the "
        "ZXP/UXP Installer again &mdash; it overwrites the old version. The "
        "&#8942; menu's update line at the bottom shows what the updater is "
        "seeing (click it for details you can send us).", body_style))

    story.append(Paragraph("Privacy", h2_style))
    story.append(Paragraph(
        "The panel sends anonymous usage pings &mdash; version, which element "
        "was added (e.g. &ldquo;lower third&rdquo;), approximate city &mdash; "
        "to a private OCHA sheet so we can see what gets used. Never any text "
        "you type, names, project names, or file paths.", body_style))

    story.append(Paragraph("Support", h2_style))
    story.append(Paragraph(
        "<font color='#009EDB'>ochavisual@un.org</font><br/>"
        "<font color='#009EDB'>brand.unocha.org</font>", body_style))

    doc.build(story, onFirstPage=_draw_footer, onLaterPages=_draw_footer)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    build()
