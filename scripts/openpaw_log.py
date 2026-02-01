#!/usr/bin/env python3
"""
OpenPaw Logging Utility

Cross-platform log viewer for OpenPaw.
On macOS: Uses unified logging system (subsystem: ai.openpaw)
On Linux: Reads from journalctl or log files

Usage:
    openpaw_log.py [OPTIONS]

Examples:
    openpaw_log.py -n 100           Show last 100 lines
    openpaw_log.py -f               Follow logs in real-time
    openpaw_log.py -e               Show only errors
    openpaw_log.py -c gateway       Filter by category
"""

import argparse
import os
import platform
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional
import re


class Colors:
    """ANSI color codes."""
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color

    @classmethod
    def disable(cls):
        """Disable colors (for non-TTY output)."""
        cls.RED = cls.GREEN = cls.YELLOW = cls.BLUE = cls.NC = ''


class LogViewer:
    """Cross-platform log viewer for OpenPaw."""

    SUBSYSTEM = "ai.openpaw"
    DEFAULT_LINES = 50
    DEFAULT_TIME_RANGE = "5m"

    # Common log categories
    CATEGORIES = [
        "gateway", "voicewake", "xpc", "notifications",
        "screenshot", "shell", "ServerManager", "SessionService",
        "TerminalManager", "GitRepository", "UnixSocket"
    ]

    def __init__(self):
        self.system = platform.system()
        if not sys.stdout.isatty():
            Colors.disable()

    def parse_time_range(self, time_str: str) -> timedelta:
        """Parse time range string like '5m', '1h', '2d' to timedelta."""
        match = re.match(r'^(\d+)([mhdw])$', time_str)
        if not match:
            raise ValueError(f"Invalid time format: {time_str}")

        value = int(match.group(1))
        unit = match.group(2)

        if unit == 'm':
            return timedelta(minutes=value)
        elif unit == 'h':
            return timedelta(hours=value)
        elif unit == 'd':
            return timedelta(days=value)
        elif unit == 'w':
            return timedelta(weeks=value)
        else:
            raise ValueError(f"Unknown time unit: {unit}")

    def build_macos_command(self, args: argparse.Namespace) -> List[str]:
        """Build macOS log command."""
        predicate = f'subsystem == "{self.SUBSYSTEM}"'

        if args.category:
            predicate += f' AND category == "{args.category}"'

        if args.errors:
            predicate += (
                ' AND (eventType == "error" OR messageType == "error" '
                'OR eventMessage CONTAINS "ERROR" OR eventMessage CONTAINS "[31m")'
            )

        if args.search:
            predicate += f' AND eventMessage CONTAINS[c] "{args.search}"'

        if args.follow:
            cmd = [
                "sudo", "log", "stream",
                "--predicate", predicate,
                "--level", "debug" if args.debug else "info",
                "--info"
            ]
        else:
            cmd = [
                "sudo", "log", "show",
                "--predicate", predicate,
                "--last", args.last,
            ]
            if args.debug:
                cmd.append("--debug")
            else:
                cmd.append("--info")

        if args.json:
            cmd.extend(["--style", "json"])

        return cmd

    def build_linux_command(self, args: argparse.Namespace) -> List[str]:
        """Build Linux journalctl command."""
        cmd = ["journalctl", "-u", "openpaw"]

        if args.follow:
            cmd.append("-f")
        else:
            # Parse time range for --since
            try:
                delta = self.parse_time_range(args.last)
                since_time = datetime.now() - delta
                cmd.extend(["--since", since_time.strftime("%Y-%m-%d %H:%M:%S")])
            except ValueError:
                pass

        if args.errors:
            cmd.extend(["-p", "err"])
        elif args.debug:
            cmd.extend(["-p", "debug"])

        if args.search:
            cmd.extend(["-g", args.search])

        if args.json:
            cmd.extend(["-o", "json"])
        else:
            cmd.extend(["-o", "cat"])  # Clean output without metadata

        cmd.extend(["-n", str(args.lines)])

        return cmd

    def get_log_files(self) -> List[Path]:
        """Get OpenPaw log file locations."""
        log_locations = [
            Path.home() / ".openpaw" / "logs",
            Path("/var/log/openpaw"),
            Path("/tmp/openpaw-gateway.log"),
        ]
        return [loc for loc in log_locations if loc.exists()]

    def read_log_files(self, args: argparse.Namespace) -> None:
        """Fallback: Read from log files directly."""
        log_paths = self.get_log_files()

        if not log_paths:
            print(f"{Colors.YELLOW}No log files found{Colors.NC}")
            return

        for log_path in log_paths:
            print(f"{Colors.BLUE}Reading from: {log_path}{Colors.NC}")

            if log_path.is_dir():
                # Read all .log files in directory
                log_files = sorted(log_path.glob("*.log"), key=lambda x: x.stat().st_mtime, reverse=True)
                for log_file in log_files[:5]:  # Last 5 log files
                    self._read_single_file(log_file, args)
            else:
                self._read_single_file(log_path, args)

    def _read_single_file(self, path: Path, args: argparse.Namespace) -> None:
        """Read a single log file with filtering."""
        try:
            with open(path, 'r') as f:
                lines = f.readlines()

            # Apply filters
            if args.errors:
                lines = [l for l in lines if 'ERROR' in l or 'error' in l.lower()]

            if args.search:
                lines = [l for l in lines if args.search.lower() in l.lower()]

            if args.category:
                lines = [l for l in lines if args.category in l]

            # Apply line limit
            if not args.all:
                lines = lines[-args.lines:]

            for line in lines:
                # Colorize errors
                if 'ERROR' in line or 'error' in line.lower():
                    print(f"{Colors.RED}{line.rstrip()}{Colors.NC}")
                elif 'WARN' in line or 'warning' in line.lower():
                    print(f"{Colors.YELLOW}{line.rstrip()}{Colors.NC}")
                else:
                    print(line.rstrip())

        except Exception as e:
            print(f"{Colors.RED}Failed to read {path}: {e}{Colors.NC}")

    def list_categories(self) -> None:
        """List available log categories."""
        print(f"{Colors.BLUE}Available log categories:{Colors.NC}\n")
        for cat in self.CATEGORIES:
            print(f"  - {cat}")
        print(f"\n{Colors.YELLOW}Note: Categories depend on active components{Colors.NC}")

    def run(self, args: argparse.Namespace) -> int:
        """Main execution."""
        if args.list_categories:
            self.list_categories()
            return 0

        # Print status header
        if args.follow:
            print(f"{Colors.GREEN}Streaming OpenPaw logs continuously...{Colors.NC}")
            print(f"{Colors.YELLOW}Press Ctrl+C to stop{Colors.NC}\n")
        else:
            if args.all:
                print(f"{Colors.GREEN}Showing all logs from the past {args.last}{Colors.NC}")
            else:
                print(f"{Colors.GREEN}Showing last {args.lines} log lines from the past {args.last}{Colors.NC}")

        if args.errors:
            print(f"{Colors.RED}Filter: Errors only{Colors.NC}")
        if args.category:
            print(f"{Colors.BLUE}Category: {args.category}{Colors.NC}")
        if args.search:
            print(f"{Colors.YELLOW}Search: \"{args.search}\"{Colors.NC}")
        print()

        # Build and run command based on platform
        try:
            if self.system == "Darwin":
                cmd = self.build_macos_command(args)
            elif self.system == "Linux":
                # Try journalctl first
                result = subprocess.run(
                    ["systemctl", "is-active", "openpaw"],
                    capture_output=True
                )
                if result.returncode == 0:
                    cmd = self.build_linux_command(args)
                else:
                    # Fall back to log files
                    self.read_log_files(args)
                    return 0
            else:
                # Unknown platform, try log files
                self.read_log_files(args)
                return 0

            # Execute command
            if args.output:
                with open(args.output, 'w') as f:
                    result = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
                line_count = sum(1 for _ in open(args.output))
                print(f"{Colors.GREEN}Exported {line_count} lines to {args.output}{Colors.NC}")
            else:
                if args.follow:
                    subprocess.run(cmd)
                else:
                    result = subprocess.run(cmd, capture_output=True, text=True)
                    output_lines = result.stdout.strip().split('\n')

                    if not args.all:
                        output_lines = output_lines[-args.lines:]

                    for line in output_lines:
                        print(line)

                    if not args.all:
                        print(f"\n{Colors.YELLOW}Showing last {args.lines} lines. Use --all or -n to see more.{Colors.NC}")

        except KeyboardInterrupt:
            print(f"\n{Colors.YELLOW}Stopped{Colors.NC}")
        except subprocess.CalledProcessError as e:
            print(f"{Colors.RED}Command failed: {e}{Colors.NC}")
            return 1
        except FileNotFoundError:
            # Command not found, fall back to log files
            self.read_log_files(args)

        return 0


def main():
    parser = argparse.ArgumentParser(
        description="OpenPaw Logging Utility",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    openpaw_log.py -n 100           Show last 100 lines
    openpaw_log.py -f               Follow logs in real-time
    openpaw_log.py -e               Show only errors
    openpaw_log.py -c gateway       Filter by category
    openpaw_log.py -s "fail"        Search for "fail"
    openpaw_log.py --server -e      Show recent server errors
        """
    )

    parser.add_argument("-f", "--follow", action="store_true",
                        help="Stream logs continuously (like tail -f)")
    parser.add_argument("-n", "--lines", type=int, default=50,
                        help="Number of lines to show (default: 50)")
    parser.add_argument("-l", "--last", default="5m",
                        help="Time range to search (default: 5m). Examples: 5m, 1h, 2d")
    parser.add_argument("-c", "--category",
                        help="Filter by category (e.g., gateway, voicewake)")
    parser.add_argument("-e", "--errors", action="store_true",
                        help="Show only error messages")
    parser.add_argument("-d", "--debug", action="store_true",
                        help="Show debug level logs (more verbose)")
    parser.add_argument("-s", "--search",
                        help="Search for specific text in log messages")
    parser.add_argument("-o", "--output",
                        help="Export logs to file")
    parser.add_argument("--server", action="store_true",
                        help="Show only server output logs")
    parser.add_argument("--all", action="store_true",
                        help="Show all logs without tail limit")
    parser.add_argument("--list-categories", action="store_true",
                        help="List all available log categories")
    parser.add_argument("--json", action="store_true",
                        help="Output in JSON format")

    args = parser.parse_args()

    if args.server:
        args.category = "ServerOutput"

    viewer = LogViewer()
    sys.exit(viewer.run(args))


if __name__ == "__main__":
    main()
