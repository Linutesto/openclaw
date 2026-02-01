#!/usr/bin/env python3
"""
Auth Expiry Monitor for OpenPaw

Run via cron or systemd timer to get proactive notifications
before Claude Code auth expires.

Suggested cron: */30 * * * * /home/admin/openpaw/scripts/auth_monitor.py

Environment variables:
  NOTIFY_PHONE - Phone number to send OpenPaw notification (e.g., +1234567890)
  NOTIFY_NTFY  - ntfy.sh topic for push notifications (e.g., openpaw-alerts)
  WARN_HOURS   - Hours before expiry to warn (default: 2)
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
import requests


class AuthMonitor:
    """Monitor Claude Code auth expiry and send notifications."""

    def __init__(self):
        self.script_dir = Path(__file__).parent.resolve()
        self.claude_creds = Path.home() / ".claude" / ".credentials.json"
        self.state_file = Path.home() / ".openpaw" / "auth-monitor-state"

        # Configuration from environment
        self.warn_hours = int(os.environ.get("WARN_HOURS", "2"))
        self.notify_phone = os.environ.get("NOTIFY_PHONE", "")
        self.notify_ntfy = os.environ.get("NOTIFY_NTFY", "")

        # Rate limiting
        self.min_interval = 3600  # 1 hour
        self.now = int(time.time())

    def get_last_notified(self) -> int:
        """Read last notification timestamp from state file."""
        try:
            return int(self.state_file.read_text().strip())
        except (FileNotFoundError, ValueError):
            return 0

    def save_notification_state(self):
        """Save current timestamp to state file."""
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(str(self.now))

    def log(self, message: str):
        """Print timestamped log message."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"{timestamp} - {message}")

    def check_auth_status_simple(self) -> Optional[str]:
        """Quick check if auth is valid (OK, EXPIRING, or EXPIRED)."""
        try:
            result = subprocess.run(
                [str(self.script_dir / "claude-auth-status.sh"), "simple"],
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout.strip()
        except Exception:
            return None

    def send_notification(self, message: str, priority: str = "default"):
        """Send notification via configured channels."""
        self.log(message)

        last_notified = self.get_last_notified()
        if (self.now - last_notified) < self.min_interval:
            self.log("Skipping notification (sent recently)")
            return

        # Send via OpenPaw if phone configured and auth still valid
        if self.notify_phone:
            auth_status = self.check_auth_status_simple()
            if auth_status and auth_status in ("OK", "EXPIRING"):
                self.log(f"Sending via OpenPaw to {self.notify_phone}...")
                try:
                    subprocess.run(
                        ["openclaw", "send", "--to", self.notify_phone, "--message", message],
                        capture_output=True,
                        timeout=30
                    )
                except Exception as e:
                    self.log(f"OpenPaw send failed: {e}")

        # Send via ntfy.sh if configured
        if self.notify_ntfy:
            self.log(f"Sending via ntfy.sh to {self.notify_ntfy}...")
            try:
                requests.post(
                    f"https://ntfy.sh/{self.notify_ntfy}",
                    data=message,
                    headers={
                        "Title": "OpenPaw Auth Alert",
                        "Priority": priority,
                        "Tags": "warning,key"
                    },
                    timeout=10
                )
            except Exception as e:
                self.log(f"ntfy.sh send failed: {e}")

        self.save_notification_state()

    def run(self) -> int:
        """Main monitoring logic. Returns exit code."""
        # Check if credentials exist
        if not self.claude_creds.exists():
            self.send_notification(
                "Claude Code credentials missing! Run: claude setup-token",
                "high"
            )
            return 1

        # Read credentials
        try:
            creds = json.loads(self.claude_creds.read_text())
            expires_at = creds.get("claudeAiOauth", {}).get("expiresAt", 0)
        except (json.JSONDecodeError, KeyError) as e:
            self.send_notification(
                f"Failed to read credentials: {e}",
                "high"
            )
            return 1

        # Calculate time remaining
        now_ms = self.now * 1000
        diff_ms = expires_at - now_ms
        hours_left = diff_ms // 3600000
        mins_left = (diff_ms % 3600000) // 60000

        if diff_ms < 0:
            self.send_notification(
                "Claude Code auth EXPIRED! OpenPaw is down. "
                "Run: ssh l36 '~/openpaw/scripts/mobile-reauth.sh'",
                "urgent"
            )
            return 1
        elif hours_left < self.warn_hours:
            self.send_notification(
                f"Claude Code auth expires in {hours_left}h {mins_left}m. "
                "Consider re-auth soon.",
                "high"
            )
            return 0
        else:
            self.log(f"Auth OK: {hours_left}h {mins_left}m remaining")
            return 0


def main():
    monitor = AuthMonitor()
    sys.exit(monitor.run())


if __name__ == "__main__":
    main()
