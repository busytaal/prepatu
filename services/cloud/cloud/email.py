"""
Transactional email via Zoho SMTP (aiosmtplib).

All sending goes through `send_email()`.  The module degrades gracefully —
if SMTP credentials are not configured it logs a warning instead of crashing,
which keeps dev environments working without a mail server.
"""

from __future__ import annotations

import textwrap
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib
from loguru import logger

from cloud.config import settings


async def send_email(*, to: str, subject: str, html: str, text: str | None = None) -> None:
    """Send a transactional email.  Silently skips if SMTP is not configured."""
    if not settings.smtp_user or not settings.smtp_password:
        logger.warning("[email] SMTP not configured — skipping send to {}", to)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = settings.email_from
    msg["To"]      = to

    if text:
        msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            start_tls=True,
        )
        logger.info("[email] Sent '{}' to {}", subject, to)
    except Exception as exc:
        logger.error("[email] Failed to send to {}: {}", to, exc)
        raise


# ── Templated emails ──────────────────────────────────────────────────────────

async def send_verification_email(to: str, token: str) -> None:
    verify_url = f"{settings.frontend_url}/auth/verify-email?token={token}"
    html = textwrap.dedent(f"""\
        <div style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#E8E8F0;background:#12121E;border-radius:12px;padding:32px;border:1px solid #2E2E44">
          <h2 style="margin:0 0 8px;color:#fff">Verify your email</h2>
          <p style="color:#9999AA;margin:0 0 24px">Click the button below to activate your Prepatu account. The link expires in 24 hours.</p>
          <a href="{verify_url}" style="display:inline-block;background:#4A90E2;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Verify email</a>
          <p style="color:#6B6B80;font-size:12px;margin-top:24px">Or copy this link: {verify_url}</p>
        </div>
    """)
    text = f"Verify your Prepatu account:\n{verify_url}"
    await send_email(to=to, subject="Verify your Prepatu email", html=html, text=text)


async def send_otp_email(to: str, code: str) -> None:
    html = textwrap.dedent(f"""\
        <div style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#E8E8F0;background:#12121E;border-radius:12px;padding:32px;border:1px solid #2E2E44">
          <h2 style="margin:0 0 8px;color:#fff">Your login code</h2>
          <p style="color:#9999AA;margin:0 0 24px">Enter this code to sign in to Prepatu. It expires in 10 minutes.</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:12px;color:#4A90E2;background:#1A1A28;border-radius:8px;padding:16px 24px;display:inline-block">{code}</div>
          <p style="color:#6B6B80;font-size:12px;margin-top:24px">If you didn't request this, ignore this email.</p>
        </div>
    """)
    text = f"Your Prepatu login code: {code}\n\nExpires in 10 minutes."
    await send_email(to=to, subject=f"{code} — Prepatu login code", html=html, text=text)
