"""Record public product demos with Playwright and a simulated account for private actions."""
import argparse
import base64
import json
from pathlib import Path
import time
from zipfile import ZipFile

from playwright.sync_api import sync_playwright

SITE = "https://fortunejobsai.com"
USER = {"id": "00000000-0000-4000-8000-000000000001", "aud": "authenticated",
        "role": "authenticated", "email": "demo@example.com", "app_metadata": {},
        "user_metadata": {"full_name": "Sample Student"}, "created_at": "2026-11-13T00:00:00Z"}
EXAMPLE = {"id": 1, "job_title": "Data Analyst", "company": "Example Company", "location": "Raleigh, NC",
           "created_at": "2026-11-13T00:00:00Z", "stage": "applied", "application_note": "Demo: follow up Friday."}


def sample_resume(path):
    with ZipFile(path, "w") as doc:
        doc.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        doc.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        lines = ["Sample Student", "Data Analyst", "demo@example.com", "Education", "B.S. Information Systems",
                 "Experience", "Data Analyst Intern | 2024–2025", "Built SQL reports and Excel dashboards for a class project.",
                 "Skills", "SQL, Python, Excel, Tableau", "Projects", "Analyzed 500 sample records and documented findings."]
        doc.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
                     ''.join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in lines) + "</w:body></w:document>")


def mock_account(context):
    claims = base64.urlsafe_b64encode(json.dumps({"sub": USER["id"], "exp": int(time.time()) + 3600}).encode()).decode().rstrip("=")
    session = {"user": USER, "access_token": "eyJhbGciOiJIUzI1NiJ9." + claims + ".Zml4dHVyZQ",
               "refresh_token": "local-fixture", "expires_at": int(time.time()) + 3600, "token_type": "bearer"}
    context.add_init_script("""for (const name of ['sb-hqgakkcxcyspqhnlnscv-auth-token']) {
      localStorage.setItem(name, %s);
    }""" % json.dumps(json.dumps(session)))


def route_request(route, signed_in):
    request = route.request
    url = request.url
    if not signed_in:
        if request.method not in ("GET", "HEAD", "OPTIONS") and "/rpc/top_hiring_companies" not in url:
            route.abort()
        else:
            route.continue_()
        return
    headers = {"access-control-allow-origin": SITE, "access-control-allow-headers": "*",
               "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS"}
    if request.method == "OPTIONS":
        route.fulfill(status=204, headers=headers)
        return
    if "/auth/v1/user" in url:
        body = USER
    elif "/rest/v1/profiles" in url:
        body = {"id": USER["id"], "full_name": "Sample Student"}
    elif "/rest/v1/saved_jobs" in url:
        body = [EXAMPLE] if request.method == "GET" and "job_key" not in url else []
    elif "/rest/v1/pre_scraped_jobs" in url and request.method == "GET":
        headers = dict(request.headers)
        if "apikey" in headers:
            headers["authorization"] = "Bearer " + headers["apikey"]
        route.continue_(headers=headers)
        return
    else:
        body = []
    route.fulfill(json=body, headers=headers)


def capture(browser, output, name, run, signed_in=False):
    context = browser.new_context(viewport={"width": 432, "height": 768},
                                  record_video_dir=output, record_video_size={"width": 432, "height": 768},
                                  reduced_motion="reduce", service_workers="block")
    context.route("https://*.supabase.co/**", lambda route: route_request(route, signed_in))
    if signed_in:
        mock_account(context)
    page = context.new_page()
    page.set_default_timeout(15000)
    try:
        run(page)
        page.wait_for_timeout(1300)
    finally:
        context.close()
    page.video.save_as(output / (name + ".webm"))
    page.video.delete()


def capture_all(output, only=None):
    output.mkdir(parents=True, exist_ok=True)
    resume = output / "sample-resume.docx"
    sample_resume(resume)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        def search(page):
            page.goto(SITE + "/find-jobs.html", wait_until="domcontentloaded")
            query = page.get_by_role("combobox", name="Job title or keyword")
            query.focus()
            query.press_sequentially("Data Analyst", delay=95)
            query.press("Escape")
            page.get_by_role("button", name="Search Jobs").click()
            page.locator(".featured-card").first.wait_for()
            page.evaluate("document.querySelector('.featured-card').scrollIntoView({block: 'start'})")
            page.screenshot(path=output / "search.png")

        def ats(page):
            page.goto(SITE + "/resume-search.html", wait_until="domcontentloaded")
            page.get_by_text("Upload your résumé", exact=False).last.wait_for()
            page.wait_for_timeout(950)
            page.locator("#guestResumeFile").set_input_files(resume)
            panel = page.locator("#atsPanel")
            panel.wait_for()
            page.evaluate("document.querySelector('#atsPanel').scrollIntoView({block: 'start'})")
            page.screenshot(path=output / "ats.png")

        def hiring(page):
            page.goto(SITE + "/", wait_until="domcontentloaded")
            heading = page.get_by_role("heading", name="Companies hiring now on Fortune Jobs AI")
            heading.wait_for()
            page.evaluate("""const section = document.querySelector('.hiring-slot');
              window.scrollTo({top: section.getBoundingClientRect().top + window.scrollY - 105, behavior: 'smooth'});""")
            page.wait_for_timeout(450)
            page.screenshot(path=output / "hiring.png")

        def tracker(page):
            page.goto(SITE + "/profile.html#saved", wait_until="domcontentloaded")
            stage = page.get_by_label("Stage for Data Analyst")
            stage.wait_for()
            page.evaluate("document.querySelector('#saved').scrollIntoView({block: 'start'})")
            stage.select_option("interview")
            page.screenshot(path=output / "tracker.png")

        def save(page):
            page.goto(SITE + "/results.html?mode=quick&q=Data+Analyst&country=us", wait_until="domcontentloaded")
            page.locator(".featured-card-select").first.click()
            button = page.get_by_role("button", name="Save job", exact=True).first
            button.scroll_into_view_if_needed()
            page.wait_for_timeout(650)
            button.click()
            page.get_by_role("button", name="Saved", exact=True).first.wait_for()
            page.screenshot(path=output / "save.png")

        for name, run, signed_in in [("search", search, False), ("ats", ats, False), ("hiring", hiring, False),
                                     ("tracker", tracker, True), ("save", save, True)]:
            if only and name != only:
                continue
            capture(browser, output, name, run, signed_in)
            print("Captured", name, flush=True)
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--only", choices=["search", "ats", "hiring", "tracker", "save"])
    args = parser.parse_args()
    capture_all(args.output.resolve(), args.only)
