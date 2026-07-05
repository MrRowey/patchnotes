#!/usr/bin/env python3
"""
generate_patch.py

Static site generator step for FAForever patch notes.

Triggered by a GitHub Action when a "Patch Submission" issue form is closed.
Reads the issue body (markdown + an embedded YAML block describing unit
changes), renders a Jinja2 HTML template, writes the resulting page into
`patches/`, and updates a JSON feed (`patches/feed.json`) used by the site's
"latest patches" list / RSS-style consumers.

Usage (CI):
    ISSUE_BODY="$ISSUE_BODY" \
    ISSUE_NUMBER="$ISSUE_NUMBER" \
    ISSUE_AUTHOR="$ISSUE_AUTHOR" \
    GITHUB_REPOSITORY="$GITHUB_REPOSITORY" \
    python scripts/generate_patch.py

    (ISSUE_URL is optional — if omitted, it's built automatically from
    GITHUB_REPOSITORY + ISSUE_NUMBER.)

Usage (local test):
    python scripts/generate_patch.py --issue-body-file sample_issue.md
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import yaml
from jinja2 import (
    Environment,
    FileSystemLoader,
    StrictUndefined,
    TemplateNotFound,
    UndefinedError,
    select_autoescape,
)

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(levelname)s: %(message)s",
)
log = logging.getLogger("generate_patch")

# Font Awesome icon used per faction in the sidebar nav (`section.icon`).
# Adjust freely — these are just sensible defaults matching the site's
# existing faction theme buttons (aeon/uef/cybran/sera).
FACTION_ICONS: dict[str, str] = {
    "uef": "fa-shield-alt",
    "cybran": "fa-microchip",
    "aeon": "fa-circle-notch",
    "seraphim": "fa-sun",
    "sera": "fa-sun",
}
DEFAULT_FACTION_ICON = "fa-star"


class PatchGenerationError(Exception):
    """Raised for any recoverable problem while generating a patch page."""


# --------------------------------------------------------------------------- #
# Parsing helpers
# --------------------------------------------------------------------------- #

def extract_section(section_name: str, markdown_text: str) -> str:
    """
    Extract the body text under a `### <section_name>` GitHub Issue Form
    heading, stopping at the next `###` heading or end of string.

    Matching is case-insensitive and tolerant of trailing whitespace or a
    parenthetical suffix on the heading, e.g. section_name="Unit Changes"
    will match both "### Unit Changes" and "### Unit Changes (YAML)" —
    GitHub Issue Forms sometimes render section headings slightly
    differently depending on how the form field was configured.
    """
    pattern = (
        rf"###[ \t]+{re.escape(section_name)}"        # the heading text
        rf"[ \t]*(?:\(.*?\))?[ \t]*\r?\n"              # optional "(...)" suffix + EOL
        rf"(.*?)"                                       # body (non-greedy)
        rf"(?=\r?\n###[ \t]|\Z)"                         # next heading or EOF
    )
    match = re.search(pattern, markdown_text, re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else ""


def extract_yaml_block(section_text: str) -> str:
    """
    Pull the contents of a fenced code block out of a section's text.

    Handles:
      - ```yaml ... ``` or plain ``` ... ``` fences
      - trailing/leading whitespace and \r\n line endings
      - GitHub's "_No response_" placeholder for empty optional fields
    """
    if not section_text or section_text.strip() in ("_No response_", ""):
        return ""

    fence_pattern = r"```(?:ya?ml)?\s*\r?\n(.*?)\r?\n?```"
    match = re.search(fence_pattern, section_text, re.DOTALL)
    if match:
        return match.group(1).strip()

    # No fence present — assume the section is raw YAML already.
    return section_text.strip()


def parse_unit_changes(yaml_text: str) -> list[dict[str, Any]]:
    """Safely parse the unit-changes YAML block into a list of dicts."""
    if not yaml_text.strip():
        return []

    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        raise PatchGenerationError(f"Could not parse 'Unit Changes (YAML)' block: {exc}") from exc

    if data is None:
        return []
    if not isinstance(data, list):
        raise PatchGenerationError(
            "'Unit Changes (YAML)' must be a YAML list of unit entries, "
            f"got {type(data).__name__} instead."
        )

    required_fields = {"unit_code", "unit_name", "faction", "change_type"}
    for i, entry in enumerate(data):
        if not isinstance(entry, dict):
            raise PatchGenerationError(f"Unit change #{i + 1} is not a mapping/object.")
        missing = required_fields - entry.keys()
        if missing:
            raise PatchGenerationError(
                f"Unit change #{i + 1} ({entry.get('unit_code', '?')}) "
                f"is missing required field(s): {', '.join(sorted(missing))}"
            )
        entry.setdefault("changes", [])
        entry.setdefault("description", "")

    return data


def slugify(value: str) -> str:
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    return re.sub(r"[-\s]+", "-", value) or "patch"


def _to_namespace(obj: Any) -> Any:
    """
    Recursively convert dicts/lists into SimpleNamespace objects so Jinja's
    `foo.bar` attribute access is safe to use everywhere in the template.

    This matters because templates/patch.html uses `section.items` — but a
    plain dict already has a built-in `.items()` method, and Jinja's
    attribute lookup (`getattr` first, `__getitem__` fallback) finds that
    method before it ever tries the dict key, causing a
    "'builtin_function_or_method' object is not iterable" error. Using
    SimpleNamespace instead of dict sidesteps the collision entirely.
    """
    if isinstance(obj, dict):
        return SimpleNamespace(**{k: _to_namespace(v) for k, v in obj.items()})
    if isinstance(obj, list):
        return [_to_namespace(v) for v in obj]
    return obj


def build_sections(units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Reshape the flat list of unit-change entries from the YAML block into
    the nested structure templates/patch.html expects:

        sections: [
          { id, title, icon, items: [
              { id, icon_url, name, change_type, faction, unit_code,
                description, change_groups: [
                    { title_title, changes: [
                        { change_type, label, old, new }, ...
                    ] }, ...
                ] }, ...
          ] }, ...
        ]

    Design decisions (adjust here if the site's grouping should differ):
      - Units are grouped into one section per faction, matching the
        sidebar's per-faction nav blocks and faction badge icons.
      - Each unit's flat `changes` list (category/label/old/new) is
        regrouped into `change_groups`, one group per distinct `category`,
        preserving first-seen order — this drives the "ChangeGroupTitle"
        (Intel, Mobility, etc.) headers in each unit card.
      - Per-line `change_type` (used for the <li> CSS class) inherits the
        unit's overall change_type (buff/nerf/adjustment), since the YAML
        schema doesn't currently carry a distinct type per stat line.
    """
    sections_by_faction: dict[str, dict[str, Any]] = {}

    for unit in units:
        faction = unit.get("faction") or "Unknown"
        faction_slug = slugify(faction)
        unit_code = unit.get("unit_code", "")
        change_type = unit.get("change_type", "")

        section = sections_by_faction.setdefault(
            faction_slug,
            {
                "id": faction_slug,
                "title": faction,
                "icon": FACTION_ICONS.get(faction_slug, DEFAULT_FACTION_ICON),
                "items": [],
            },
        )

        groups_by_category: dict[str, dict[str, Any]] = {}
        for change in unit.get("changes", []):
            category = change.get("category") or "General"
            group = groups_by_category.setdefault(
                category, {"title_title": category, "changes": []}
            )
            group["changes"].append(
                {
                    "change_type": change_type,
                    "label": change.get("label", ""),
                    "old": change.get("old", ""),
                    "new": change.get("new", ""),
                }
            )

        section["items"].append(
            {
                "id": unit_code or slugify(unit.get("unit_name", "unit")),
                "icon_url": f"/assets/images/units/{faction_slug}/{unit_code}_icon.png",
                "name": unit.get("unit_name", ""),
                "change_type": change_type,
                "faction": faction,
                "unit_code": unit_code,
                "description": unit.get("description", ""),
                "change_groups": list(groups_by_category.values()),
            }
        )

    return list(sections_by_faction.values())


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #

@dataclass
class PatchNote:
    version: str
    summary: str
    units: list[dict[str, Any]]
    issue_number: str | None = None
    issue_url: str | None = None
    author: str | None = None
    date: str = field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    @property
    def slug(self) -> str:
        return slugify(f"patch-{self.version}")

    @property
    def filename(self) -> str:
        return f"{self.slug}.html"

    def to_feed_entry(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "summary": self.summary,
            "date": self.date,
            "url": f"patches/{self.filename}",
            "issue_number": self.issue_number,
            "issue_url": self.issue_url,
            "author": self.author,
            "unit_count": len(self.units),
        }


# --------------------------------------------------------------------------- #
# Core generation logic
# --------------------------------------------------------------------------- #

def sanitize_issue_body(issue_body: str) -> str:
    """
    Clean characters that come from copy-pasting into the GitHub issue form
    but silently break downstream parsing:
      - U+00A0 (non-breaking space) -> regular space. PyYAML treats \\xa0
        as a non-whitespace character, so indentation-sensitive YAML blocks
        break in confusing ways if one sneaks in.
    """
    return issue_body.replace("\xa0", " ")


def parse_issue_body(issue_body: str) -> tuple[str, str, list[dict[str, Any]]]:
    issue_body = sanitize_issue_body(issue_body)

    version = extract_section("Patch Version", issue_body).strip()
    summary = extract_section("Patch Summary", issue_body).strip()
    # Matches "### Unit Changes" and "### Unit Changes (YAML)" alike.
    raw_units_section = extract_section("Unit Changes", issue_body)

    if not version:
        raise PatchGenerationError("Issue body is missing a 'Patch Version' section.")

    yaml_text = extract_yaml_block(raw_units_section)
    units = parse_unit_changes(yaml_text)

    return version, summary, units


def render_patch_html(patch: PatchNote, template_dir: Path, template_name: str) -> str:
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
        # StrictUndefined makes an unknown/misspelled template variable raise
        # immediately, instead of Jinja's default of silently rendering "" —
        # which is exactly how a render()/template mismatch went unnoticed
        # before.
        undefined=StrictUndefined,
    )
    try:
        template = env.get_template(template_name)
    except TemplateNotFound as exc:
        raise PatchGenerationError(f"Template '{template_name}' not found in {template_dir}") from exc

    sections = [_to_namespace(section) for section in build_sections(patch.units)]
    total_changes_count = sum(len(unit.get("changes", [])) for unit in patch.units)

    try:
        release_date_formatted = datetime.strptime(patch.date, "%Y-%m-%d").strftime("%B %-d, %Y")
    except ValueError:
        release_date_formatted = patch.date

    # NOTE: these keyword names must match the variable names used in
    # templates/patch.html exactly: patch_number, description, release_date,
    # release_date_formatted, sections (-> items -> change_groups -> changes),
    # total_changes_count. The template doesn't reference issue metadata or
    # author, so those aren't passed here (they still live in the JSON feed).
    try:
        return template.render(
            patch_number=patch.version,
            description=patch.summary,
            release_date=patch.date,
            release_date_formatted=release_date_formatted,
            sections=sections,
            total_changes_count=total_changes_count,
        )
    except UndefinedError as exc:
        raise PatchGenerationError(
            f"Template '{template_name}' references a variable that render() doesn't provide: {exc}"
        ) from exc


def atomic_write(path: Path, content: str) -> None:
    """Write a file atomically to avoid partial writes if the job is interrupted."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        shutil.move(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def update_feed(feed_path: Path, entry: dict[str, Any]) -> None:
    """Insert/replace this patch's entry in the JSON feed, newest first."""
    if feed_path.exists():
        try:
            feed = json.loads(feed_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise PatchGenerationError(f"Existing feed at {feed_path} is not valid JSON: {exc}") from exc
    else:
        feed = {"patches": []}

    feed.setdefault("patches", [])
    # Replace an existing entry for the same version, if the issue was edited/reopened.
    feed["patches"] = [p for p in feed["patches"] if p.get("version") != entry["version"]]
    feed["patches"].append(entry)
    feed["patches"].sort(key=lambda p: p.get("date", ""), reverse=True)
    feed["updated_at"] = datetime.now(timezone.utc).isoformat()

    atomic_write(feed_path, json.dumps(feed, indent=2, ensure_ascii=False) + "\n")


def generate_patch(
    issue_body: str,
    template_path: str = "templates/patch.html",
    patches_dir: str = "patches",
    feed_filename: str = "feed.json",
    issue_number: str | None = None,
    issue_url: str | None = None,
    author: str | None = None,
) -> PatchNote:
    """
    Parse an issue body, render the patch HTML page, and update the JSON feed.

    Returns the PatchNote that was generated, for use by the caller
    (e.g. to set GitHub Action outputs).
    """
    version, summary, units = parse_issue_body(issue_body)

    patch = PatchNote(
        version=version,
        summary=summary,
        units=units,
        issue_number=issue_number,
        issue_url=issue_url,
        author=author,
    )

    template_path_obj = Path(template_path)
    html = render_patch_html(patch, template_path_obj.parent, template_path_obj.name)

    patches_dir_obj = Path(patches_dir)
    output_path = patches_dir_obj / patch.filename
    atomic_write(output_path, html)
    log.info("Wrote %s", output_path)

    feed_path = patches_dir_obj / feed_filename
    update_feed(feed_path, patch.to_feed_entry())
    log.info("Updated feed %s", feed_path)

    return patch


# --------------------------------------------------------------------------- #
# CLI / GitHub Actions entry point
# --------------------------------------------------------------------------- #

def write_github_output(patch: PatchNote) -> None:
    """Expose useful values to later workflow steps via GITHUB_OUTPUT."""
    gh_output = os.environ.get("GITHUB_OUTPUT")
    if not gh_output:
        return
    with open(gh_output, "a", encoding="utf-8") as f:
        f.write(f"patch_version={patch.version}\n")
        f.write(f"patch_file=patches/{patch.filename}\n")


def write_step_summary(message: str, *, is_error: bool = False) -> None:
    gh_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not gh_summary:
        return
    prefix = "### ❌ Patch generation failed" if is_error else "### ✅ Patch generated"
    with open(gh_summary, "a", encoding="utf-8") as f:
        f.write(f"{prefix}\n\n{message}\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a FAForever patch notes page from an issue body.")
    parser.add_argument("--issue-body-file", type=str, help="Read the issue body from a file instead of $ISSUE_BODY.")
    parser.add_argument("--template", default="templates/patch.html", help="Path to the Jinja2 template.")
    parser.add_argument("--patches-dir", default="patches", help="Output directory for rendered pages + feed.")
    parser.add_argument("--feed-filename", default="feed.json", help="Filename of the JSON feed inside patches-dir.")
    return parser.parse_args()


def resolve_issue_url(issue_number: str | None) -> str | None:
    """
    Prefer an explicit $ISSUE_URL if the workflow provides one. Otherwise,
    build it from $GITHUB_REPOSITORY (auto-set by GitHub Actions, e.g.
    "MrRowey/patchnotes") + the issue number.
    """
    explicit = os.environ.get("ISSUE_URL")
    if explicit:
        return explicit

    repo = os.environ.get("GITHUB_REPOSITORY")
    if repo and issue_number:
        return f"https://github.com/{repo}/issues/{issue_number}"

    return None


def main() -> int:
    args = parse_args()

    if args.issue_body_file:
        issue_body = Path(args.issue_body_file).read_text(encoding="utf-8")
    else:
        issue_body = os.environ.get("ISSUE_BODY", "")

    if not issue_body.strip():
        log.error("No issue body provided (set $ISSUE_BODY or pass --issue-body-file).")
        write_step_summary("No issue body was provided.", is_error=True)
        return 1

    issue_number = os.environ.get("ISSUE_NUMBER")

    try:
        patch = generate_patch(
            issue_body=issue_body,
            template_path=args.template,
            patches_dir=args.patches_dir,
            feed_filename=args.feed_filename,
            issue_number=issue_number,
            issue_url=resolve_issue_url(issue_number),
            author=os.environ.get("ISSUE_AUTHOR"),
        )
    except PatchGenerationError as exc:
        log.error("Patch generation failed: %s", exc)
        write_step_summary(str(exc), is_error=True)
        return 1
    except Exception as exc:  # noqa: BLE001 - surface unexpected errors clearly in CI logs
        log.exception("Unexpected error during patch generation")
        write_step_summary(f"Unexpected error: {exc}", is_error=True)
        return 1

    write_github_output(patch)
    write_step_summary(
        f"**Version:** {patch.version}\n\n**Units changed:** {len(patch.units)}\n\n"
        f"**File:** `patches/{patch.filename}`"
    )
    log.info("Done. Patch %s generated with %d unit change(s).", patch.version, len(patch.units))
    return 0


if __name__ == "__main__":
    sys.exit(main())