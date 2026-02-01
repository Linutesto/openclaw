#!/usr/bin/env python3
"""
OpenClaw → OpenPaw Rebranding Script

Performs systematic replacement across the codebase with careful handling of:
- Binary/CLI names (openclaw → openpaw)
- Config paths (~/.openclaw → ~/.openpaw)
- Environment variables (OPENCLAW_* → OPENPAW_*)
- Package names
- Documentation
- Product names (OpenClaw → OpenPaw)

Usage:
    python3 scripts/rebrand.py --dry-run    # Preview changes
    python3 scripts/rebrand.py --apply      # Apply changes
"""

import os
import sys
import re
import argparse
from pathlib import Path
from typing import List, Tuple, Dict
from collections import defaultdict


# File extensions to process
INCLUDE_EXTENSIONS = {
    '.ts', '.tsx', '.js', '.mjs', '.jsx',
    '.json', '.md', '.mdx',
    '.sh', '.bash',
    '.yaml', '.yml',
    '.html', '.css',
    '.swift', '.kt', '.kts',
    '.plist',
}

# Directories to skip
SKIP_DIRS = {
    'node_modules', '.git', 'dist', 'build', '.next',
    '__pycache__', '.venv', 'venv', '.cache',
    'coverage', '.nyc_output',
}

# Replacement rules (order matters for some)
REPLACEMENTS: List[Tuple[str, str]] = [
    # Environment variables (uppercase)
    (r'OPENCLAW_', 'OPENPAW_'),

    # CLI commands and binaries
    (r'openclaw-mac', 'openpaw-mac'),
    (r'openclaw-gateway', 'openpaw-gateway'),
    (r'openclaw\.mjs', 'openpaw.mjs'),

    # Config paths
    (r'~/.openclaw/', '~/.openpaw/'),
    (r'\$HOME/.openclaw/', '$HOME/.openpaw/'),
    (r'\.openclaw/', '.openpaw/'),

    # Package scopes
    (r'@openclaw/', '@openpaw/'),

    # URLs
    (r'docs\.openclaw\.ai', 'docs.openpaw.ai'),
    (r'openclaw\.ai', 'openpaw.ai'),
    (r'github\.com/openclaw/openclaw', 'github.com/openpaw/openpaw'),
    (r'github\.com/openclaw/', 'github.com/openpaw/'),

    # Subsystem identifiers
    (r'ai\.openclaw\.', 'ai.openpaw.'),

    # Web components
    (r'<openclaw-', '<openpaw-'),
    (r'</openclaw-', '</openpaw-'),
    (r'openclaw-app', 'openpaw-app'),
    (r'openclaw-control-ui', 'openpaw-control-ui'),

    # Product names (capitalized)
    (r'OpenClawKit', 'OpenPawKit'),
    (r'OpenClawApp', 'OpenPawApp'),
    (r'OpenClaw\.app', 'OpenPaw.app'),
    (r'OpenClaw\.xcodeproj', 'OpenPaw.xcodeproj'),

    # Generic replacements (most specific last)
    # CLI command (word boundary)
    (r'\bopenclaw\b', 'openpaw'),

    # Product name (capitalized, word boundary)
    (r'\bOpenClaw\b', 'OpenPaw'),
]

# Files to skip completely
SKIP_FILES = {
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    '.bundle.hash',
}


class Rebrander:
    def __init__(self, root: Path, dry_run: bool = True):
        self.root = root
        self.dry_run = dry_run
        self.stats: Dict[str, int] = defaultdict(int)
        self.changes: List[Tuple[Path, int, str]] = []

    def should_process(self, path: Path) -> bool:
        """Check if file should be processed."""
        if path.name in SKIP_FILES:
            return False

        if path.suffix not in INCLUDE_EXTENSIONS:
            return False

        # Check if any parent is in skip dirs
        for parent in path.parents:
            if parent.name in SKIP_DIRS:
                return False

        return True

    def apply_replacements(self, content: str) -> Tuple[str, int]:
        """Apply all replacements and return (new_content, change_count)."""
        total_changes = 0

        for pattern, replacement in REPLACEMENTS:
            # Count matches before replacing
            matches = len(re.findall(pattern, content))
            if matches > 0:
                content = re.sub(pattern, replacement, content)
                total_changes += matches

        return content, total_changes

    def process_file(self, path: Path) -> bool:
        """Process a single file. Returns True if changes were made."""
        try:
            content = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, PermissionError):
            return False

        new_content, changes = self.apply_replacements(content)

        if changes > 0:
            self.stats[path.suffix] += changes
            self.changes.append((path.relative_to(self.root), changes, path.suffix))

            if not self.dry_run:
                path.write_text(new_content, encoding='utf-8')

            return True

        return False

    def run(self) -> Dict:
        """Run the rebranding process."""
        files_processed = 0
        files_changed = 0

        for path in self.root.rglob('*'):
            if not path.is_file():
                continue

            if not self.should_process(path):
                continue

            files_processed += 1
            if self.process_file(path):
                files_changed += 1

        return {
            'files_processed': files_processed,
            'files_changed': files_changed,
            'total_changes': sum(self.stats.values()),
            'by_extension': dict(self.stats),
            'changes': self.changes[:100],  # Top 100 for display
        }


def main():
    parser = argparse.ArgumentParser(description='Rebrand OpenClaw to OpenPaw')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without applying')
    parser.add_argument('--apply', action='store_true', help='Apply changes')
    parser.add_argument('--root', default='.', help='Repository root')

    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply")
        sys.exit(1)

    root = Path(args.root).resolve()
    dry_run = not args.apply

    print(f"{'[DRY RUN] ' if dry_run else ''}Rebranding OpenClaw → OpenPaw")
    print(f"Root: {root}")
    print("=" * 60)

    rebrander = Rebrander(root, dry_run=dry_run)
    result = rebrander.run()

    print(f"\nFiles processed: {result['files_processed']}")
    print(f"Files changed: {result['files_changed']}")
    print(f"Total replacements: {result['total_changes']}")

    print("\nBy file type:")
    for ext, count in sorted(result['by_extension'].items(), key=lambda x: -x[1]):
        print(f"  {ext:10} {count:6} changes")

    if result['changes']:
        print("\nTop changed files:")
        sorted_changes = sorted(result['changes'], key=lambda x: -x[1])[:20]
        for path, count, ext in sorted_changes:
            print(f"  {count:4} changes  {path}")

    if dry_run:
        print("\n[DRY RUN] No files were modified. Use --apply to make changes.")
    else:
        print("\n[APPLIED] Changes have been written to disk.")


if __name__ == "__main__":
    main()
