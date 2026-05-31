#!/usr/bin/env python3
"""Static audit for untrusted agent skills.

This script never executes target code. It walks a skill or repo directory and
reports supply-chain risks that matter before a skill is imported into ShipCode.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


TEXT_EXTENSIONS = {
    ".bash",
    ".cjs",
    ".cfg",
    ".conf",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".mjs",
    ".md",
    ".mdc",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

CODE_EXTENSIONS = {
    ".bash",
    ".cjs",
    ".js",
    ".jsx",
    ".mjs",
    ".py",
    ".sh",
    ".ts",
    ".tsx",
}

BINARY_EXTENSIONS = {
    ".7z",
    ".bin",
    ".dll",
    ".dmg",
    ".exe",
    ".jar",
    ".o",
    ".pyc",
    ".so",
    ".tar",
    ".tgz",
    ".wasm",
    ".zip",
}

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".turbo",
    "dist",
    "build",
}

ALLOW_MARKER = "shipcode-audit: allow-pattern-example"


@dataclass(frozen=True)
class Finding:
    severity: str
    category: str
    path: str
    line: int | None
    message: str
    remediation: str


@dataclass(frozen=True)
class Rule:
    severity: str
    category: str
    pattern: re.Pattern[str]
    message: str
    remediation: str
    file_kinds: frozenset[str]


RULES = [
    Rule(
        "critical",
        "code-exec",
        re.compile(r"\b(eval|exec)\s*\("),  # shipcode-audit: allow-pattern-example
        "Dynamic code execution detected.",
        "Remove dynamic execution. Use explicit parsing or a narrow allowlist.",
        frozenset({"code"}),
    ),
    Rule(
        "critical",
        "code-exec",
        re.compile(r"(?<!\.)\bcompile\s*\(|__import__\s*\("),  # shipcode-audit: allow-pattern-example
        "Dynamic compilation or import detected.",
        "Replace dynamic import/compile behavior with explicit modules.",
        frozenset({"code"}),
    ),
    Rule(
        "critical",
        "shell-exec",
        re.compile(r"os\.(system|popen)\s*\(|subprocess\.[a-zA-Z_]+\([^\\n)]*shell\s*=\s*True"),  # shipcode-audit: allow-pattern-example
        "Shell execution can allow command injection.",
        "Use subprocess.run with list arguments and shell=False.",
        frozenset({"code"}),
    ),
    Rule(
        "critical",
        "shell-exec",
        re.compile(r"child_process\.(exec|execSync)\s*\("),  # shipcode-audit: allow-pattern-example
        "Node shell execution or template shell command detected.",
        "Use execFile/spawn with shell disabled and list arguments.",
        frozenset({"code"}),
    ),
    Rule(
        "critical",
        "credential-access",
        re.compile(r"((?<!\w)\.(ssh|aws|gnupg|npmrc)\b|id_rsa|id_ed25519|keychain|(?<!\w)\.config/gh|(?<!\w)\.docker/config|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN)"),  # shipcode-audit: allow-pattern-example
        "Credential or token access pattern detected.",
        "Remove credential reads. Ask the user for scoped configuration instead.",
        frozenset({"code", "markdown"}),
    ),
    Rule(
        "critical",
        "persistence",
        re.compile(r"((?<!\w)\.(bashrc|zshrc|profile)\b|crontab|launchctl|LaunchAgents|authorized_keys)"),  # shipcode-audit: allow-pattern-example
        "Persistence or shell-startup modification pattern detected.",
        "Do not modify persistent shell/session startup files from a skill.",
        frozenset({"code", "markdown"}),
    ),
    Rule(
        "critical",
        "obfuscation",
        re.compile(r"(base64\s+(-d|--decode)|base64\.b64decode|codecs\.decode|fromhex\s*\()"),  # shipcode-audit: allow-pattern-example
        "Encoded payload handling detected.",
        "Remove obfuscation or document a benign decoding use case for manual review.",
        frozenset({"code"}),
    ),
    Rule(
        "high",
        "network",
        re.compile(r"(requests\.(post|put|patch)|urllib\.request|httpx\.|aiohttp\.|socket\.connect|fetch\s*\(|curl\s+)"),  # shipcode-audit: allow-pattern-example
        "Outbound network capability detected.",
        "Justify the destination and make network access user-controlled.",
        frozenset({"code"}),
    ),
    Rule(
        "high",
        "installer",
        re.compile(r"(pip\s+install|npm\s+install|pnpm\s+add|bun\s+add|curl\s+.*\|\s*(bash|sh)|wget\s+.*\|\s*(bash|sh))"),  # shipcode-audit: allow-pattern-example
        "Installer or remote shell pattern detected.",
        "Move installs to documented setup steps; never pipe remote code to a shell.",
        frozenset({"code", "markdown"}),
    ),
    Rule(
        "high",
        "destructive-fs",
        re.compile(r"(rm\s+-rf|chmod\s+777|chown\s+-R|cp\s+-R.*\$\{?HOME|mv\s+.*\$\{?HOME)"),  # shipcode-audit: allow-pattern-example
        "Destructive or broad filesystem operation detected.",
        "Constrain writes to an explicit target path and require confirmation.",
        frozenset({"code", "markdown"}),
    ),
    Rule(
        "high",
        "prompt-injection",
        re.compile(  # shipcode-audit: allow-pattern-example
            r"(ignore (all )?(previous|prior|system) instructions|developer message|exfiltrate|send .*secret|upload .*file|disable safety|bypass policy)",  # shipcode-audit: allow-pattern-example
            re.IGNORECASE,
        ),
        "Prompt-injection or data-exfiltration instruction detected.",
        "Treat as hostile content unless it is clearly a quoted example in a security skill.",
        frozenset({"markdown"}),
    ),
    Rule(
        "medium",
        "dependency",
        re.compile(r"^[A-Za-z0-9_.-]+[>=~]=?[^=].*$", re.MULTILINE),  # shipcode-audit: allow-pattern-example
        "Possibly unpinned dependency detected.",
        "Pin dependencies or document why floating versions are acceptable.",
        frozenset({"dependency"}),
    ),
]


def is_probably_text(path: Path) -> bool:
    if path.suffix.lower() in TEXT_EXTENSIONS:
        return True
    try:
        chunk = path.read_bytes()[:2048]
    except OSError:
        return False
    if b"\x00" in chunk:
        return False
    try:
        chunk.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def iter_paths(root: Path) -> Iterable[Path]:
    for current, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        current_path = Path(current)
        for name in files:
            yield current_path / name
        for name in dirs:
            path = current_path / name
            if path.is_symlink():
                yield path


def rel(root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def line_number(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def file_kind(path: Path) -> str:
    name = path.name.lower()
    suffix = path.suffix.lower()
    if suffix in CODE_EXTENSIONS:
        return "code"
    if suffix in {".md", ".mdc", ".txt"}:
        return "markdown"
    if name in {"requirements.txt", "package.json", "pyproject.toml"}:
        return "dependency"
    return "text"


def add(
    findings: list[Finding],
    severity: str,
    category: str,
    root: Path,
    path: Path,
    line: int | None,
    message: str,
    remediation: str,
) -> None:
    findings.append(Finding(severity, category, rel(root, path), line, message, remediation))


def scan_text_file(root: Path, path: Path, findings: list[Finding]) -> None:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        add(findings, "medium", "read-error", root, path, None, f"Could not read file: {exc}", "Inspect filesystem permissions.")
        return

    kind = file_kind(path)
    for rule in RULES:
        if kind not in rule.file_kinds:
            continue
        seen_rule_lines: set[int] = set()
        for match in rule.pattern.finditer(text):
            line = line_number(text, match.start())
            line_text = text.splitlines()[line - 1] if line > 0 else ""
            if ALLOW_MARKER in line_text:
                continue
            if line in seen_rule_lines:
                continue
            seen_rule_lines.add(line)
            add(
                findings,
                rule.severity,
                rule.category,
                root,
                path,
                line,
                rule.message,
                rule.remediation,
            )

    lower_name = path.name.lower()
    if lower_name in {"settings.json", "hooks.json"} or "hook" in str(path).lower():
        if re.search(r'"hooks?"\s*:|"PreToolUse"|"PostToolUse"|"SessionStart"|"SessionEnd"|"command"\s*:', text):
            add(
                findings,
                "high",
                "auto-hook",
                root,
                path,
                None,
                "Automatic hook or command registration detected.",
                "Review manually. Do not auto-enable hooks during import.",
            )


def scan_path(root: Path, path: Path, findings: list[Finding]) -> None:
    if path.is_symlink():
        try:
            target = path.resolve(strict=False)
            target.relative_to(root)
        except ValueError:
            add(
                findings,
                "critical",
                "symlink",
                root,
                path,
                None,
                f"Symlink escapes target root: {os.readlink(path)}",
                "Replace with a regular file or an in-root relative symlink.",
            )
        return

    suffix = path.suffix.lower()
    name = path.name

    if suffix in BINARY_EXTENSIONS:
        add(
            findings,
            "critical",
            "binary",
            root,
            path,
            None,
            "Unexpected binary/archive file in skill bundle.",
            "Remove binaries from skills or require separate manual provenance review.",
        )

    if name.startswith(".") and name not in {".gitignore"}:
        add(
            findings,
            "medium",
            "hidden-file",
            root,
            path,
            None,
            "Hidden file present in skill bundle.",
            "Remove hidden files unless they are required and documented.",
        )

    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    if size > 1_000_000:
        add(
            findings,
            "medium",
            "large-file",
            root,
            path,
            None,
            f"Large file present ({size} bytes).",
            "Inspect manually; large files can hide payloads or bloat imports.",
        )

    if is_probably_text(path):
        scan_text_file(root, path, findings)
    elif suffix not in BINARY_EXTENSIONS:
        add(
            findings,
            "medium",
            "non-text",
            root,
            path,
            None,
            "Non-text file could not be inspected.",
            "Remove or manually verify non-text files before import.",
        )


def structure_findings(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    skill_files = [p for p in root.rglob("SKILL.md") if ".git" not in p.parts and "node_modules" not in p.parts]
    if not skill_files:
        add(
            findings,
            "critical",
            "structure",
            root,
            root,
            None,
            "No SKILL.md found.",
            "A valid skill import must include a SKILL.md file.",
        )
    elif len(skill_files) > 1:
        add(
            findings,
            "high",
            "structure",
            root,
            root,
            None,
            f"Multiple SKILL.md files found ({len(skill_files)}).",
            "Import one skill at a time or split the bundle before approval.",
        )
    return findings


def verdict(findings: list[Finding], strict: bool) -> str:
    counts = count_by_severity(findings)
    if counts["critical"] > 0:
        return "fail"
    if strict and (counts["high"] > 0 or counts["medium"] > 0):
        return "fail"
    if counts["high"] > 0 or counts["medium"] > 0:
        return "warn"
    return "pass"


def count_by_severity(findings: list[Finding]) -> dict[str, int]:
    counts = {"critical": 0, "high": 0, "medium": 0, "info": 0}
    for finding in findings:
        counts[finding.severity] = counts.get(finding.severity, 0) + 1
    return counts


def audit(root: Path, strict: bool) -> dict[str, object]:
    root = root.resolve()
    findings = structure_findings(root)
    for path in iter_paths(root):
        scan_path(root, path, findings)
    findings.sort(key=lambda f: ({"critical": 0, "high": 1, "medium": 2, "info": 3}.get(f.severity, 9), f.path, f.line or 0))
    counts = count_by_severity(findings)
    result = {
        "target": str(root),
        "verdict": verdict(findings, strict),
        "strict": strict,
        "counts": counts,
        "findings": [asdict(f) for f in findings],
    }
    return result


def print_text_report(result: dict[str, object], max_findings: int) -> None:
    counts = result["counts"]
    assert isinstance(counts, dict)
    print(f"Verdict: {result['verdict']}")
    print(f"Target: {result['target']}")
    print()
    print(
        "Critical: {critical}  High: {high}  Medium: {medium}  Info: {info}".format(
            critical=counts.get("critical", 0),
            high=counts.get("high", 0),
            medium=counts.get("medium", 0),
            info=counts.get("info", 0),
        )
    )
    print()
    findings = result["findings"]
    assert isinstance(findings, list)
    if not findings:
        print("Findings: none")
        return
    print("Findings:")
    shown = findings[:max_findings]
    for item in shown:
        assert isinstance(item, dict)
        location = item["path"]
        if item.get("line"):
            location = f"{location}:{item['line']}"
        print(f"- [{item['severity']}] {location} ({item['category']}) {item['message']}")
        print(f"  Fix: {item['remediation']}")
    if len(findings) > len(shown):
        print()
        print(f"... {len(findings) - len(shown)} more findings omitted from text output. Use --json for the full report.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Static security audit for agent skills.")
    parser.add_argument("target", help="Path to a skill folder or repository checkout.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of text.")
    parser.add_argument("--strict", action="store_true", help="Treat high/medium findings as failure.")
    parser.add_argument("--max-findings", type=int, default=50, help="Maximum findings to show in text output.")
    args = parser.parse_args(argv)

    root = Path(args.target)
    if not root.exists():
        print(f"Target not found: {root}", file=sys.stderr)
        return 2
    if not root.is_dir():
        print(f"Target must be a directory: {root}", file=sys.stderr)
        return 2

    result = audit(root, args.strict)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print_text_report(result, max(1, args.max_findings))

    return 0 if result["verdict"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
