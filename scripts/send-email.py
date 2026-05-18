#!/usr/bin/env python3
"""Send a Gmail message with optional attachments via SMTP + an App Password.

Reads GMAIL_ADDRESS and GMAIL_APP_PASSWORD from the project root .env.
Attachments are read from local paths and embedded in the message body.

Example:
    python scripts/send-email.py \\
        --to recipient@example.com \\
        --subject "Hello" \\
        --body-file /tmp/body.txt \\
        --attach ~/Desktop/file.zip

Use --body for short inline bodies, or --body-file for longer text (avoids
shell-quoting headaches).
"""

import argparse
import mimetypes
import os
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path


SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465


def load_env(env_path: Path) -> dict[str, str]:
    """Minimal .env reader — returns key/value pairs, ignores comments/blanks."""
    out: dict[str, str] = {}
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def attach_file(msg: EmailMessage, path: Path) -> None:
    """Read a file and attach it to msg with a guessed MIME type."""
    if not path.exists():
        sys.exit(f"attachment not found: {path}")
    ctype, encoding = mimetypes.guess_type(str(path))
    if ctype is None or encoding is not None:
        ctype = "application/octet-stream"
    maintype, subtype = ctype.split("/", 1)
    msg.add_attachment(
        path.read_bytes(),
        maintype=maintype,
        subtype=subtype,
        filename=path.name,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--to", required=True, action="append",
                    help="recipient (repeat for multiple)")
    ap.add_argument("--subject", required=True)
    body_group = ap.add_mutually_exclusive_group(required=True)
    body_group.add_argument("--body", help="message body text")
    body_group.add_argument("--body-file", help="path to file containing body")
    ap.add_argument("--attach", action="append", default=[],
                    help="file path to attach (repeat for multiple)")
    args = ap.parse_args()

    env_path = Path(__file__).resolve().parent.parent / ".env"
    env = load_env(env_path)
    sender = env.get("GMAIL_ADDRESS")
    password = env.get("GMAIL_APP_PASSWORD")
    if not sender or not password:
        sys.exit(
            f"GMAIL_ADDRESS / GMAIL_APP_PASSWORD missing from {env_path}"
        )

    body = args.body if args.body else Path(args.body_file).read_text()

    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(args.to)
    msg["Subject"] = args.subject
    msg.set_content(body)

    for raw_path in args.attach:
        path = Path(os.path.expanduser(raw_path)).resolve()
        attach_file(msg, path)
        print(f"  attached: {path} ({path.stat().st_size} bytes)")

    print(f"  sending from {sender} to {', '.join(args.to)}…")
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as smtp:
        smtp.login(sender, password)
        smtp.send_message(msg)
    print("✓ sent")


if __name__ == "__main__":
    main()
