from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "public" / "index.html").read_text()
css = (ROOT / "public" / "styles.css").read_text()

with sync_playwright() as p:
    launch = {"headless": True, "args": ["--no-sandbox"]}
    if os.getenv("PLAYWRIGHT_CHROMIUM_PATH"):
        launch["executable_path"] = os.environ["PLAYWRIGHT_CHROMIUM_PATH"]
    browser = p.chromium.launch(**launch)
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    page.set_content(html, wait_until="domcontentloaded")
    page.add_style_tag(content=css)

    assert page.locator("h1").inner_text().startswith("Give a website a new face")
    assert page.get_by_text("Dual gate").is_visible()
    assert page.get_by_text("Opera lane").is_visible()
    assert page.get_by_text("Public read").is_visible()

    page.evaluate("document.querySelector('#notice').showModal()")
    assert page.get_by_text("Choose what the AI may do.").is_visible()
    assert page.locator("input[value='scrape:public']").is_checked()
    assert not page.locator("input[value='browser:read']").is_checked()
    assert not page.locator("input[value='browser:navigate']").is_checked()
    assert page.get_by_text("Browser-wide tabs and history stay blocked.").is_visible()
    page.screenshot(path=str(ROOT / "playwright-home.png"), full_page=True)
    browser.close()

print("playwright visual consent smoke: PASS")
