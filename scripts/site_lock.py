#!/usr/bin/env python3
"""Safely reclaim and release mkdir-based site locks.

The short advisory guard closes the check/rename race between concurrent
waiters. The guard is released by the kernel if this process exits.
"""

import argparse
import fcntl
import os
import secrets
import sys
import time
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    reclaim = subparsers.add_parser("reclaim")
    reclaim.add_argument("lock_dir", type=Path)
    reclaim.add_argument("ttl", type=int)
    reclaim.add_argument("creation_grace", type=int)

    release = subparsers.add_parser("release")
    release.add_argument("lock_dir", type=Path)
    release.add_argument("token")
    return parser.parse_args()


def owner_values(owner_path):
    values = {}
    try:
        for line in owner_path.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator:
                values[key] = value
    except (FileNotFoundError, OSError, UnicodeError):
        pass
    return values


def process_is_alive(raw_pid):
    try:
        pid = int(raw_pid)
        if pid <= 0:
            return False
        os.kill(pid, 0)
        return True
    except PermissionError:
        return None
    except (ProcessLookupError, TypeError, ValueError):
        return False


def open_guard(lock_dir, nonblocking):
    guard_path = Path(f"{lock_dir}.reclaim.guard")
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(guard_path, flags, 0o600)
    operation = fcntl.LOCK_EX | (fcntl.LOCK_NB if nonblocking else 0)
    try:
        fcntl.flock(descriptor, operation)
    except BlockingIOError:
        os.close(descriptor)
        return None
    return descriptor


def safe_lock_dir(lock_dir):
    return lock_dir.exists() and lock_dir.is_dir() and not lock_dir.is_symlink()


def reclaim_lock(lock_dir, ttl, creation_grace):
    if ttl <= 0 or creation_grace < 0:
        return 2
    descriptor = open_guard(lock_dir, nonblocking=True)
    if descriptor is None:
        return 1
    try:
        if not safe_lock_dir(lock_dir):
            return 1
        owner_path = lock_dir / "owner"
        values = owner_values(owner_path)
        raw_pid = values.get("pid", "")
        raw_started_at = values.get("started_at", "")
        token = values.get("token", "")
        try:
            pid = int(raw_pid)
            started_at = int(raw_started_at)
            metadata_is_valid = pid > 0 and started_at > 0 and bool(token)
        except ValueError:
            metadata_is_valid = False
            started_at = 0
        if not metadata_is_valid:
            started_at = int(lock_dir.stat().st_mtime)
        age = max(0, int(time.time()) - started_at)
        has_owner = (
            owner_path.is_file()
            and not owner_path.is_symlink()
            and metadata_is_valid
        )
        alive = process_is_alive(raw_pid)
        if not has_owner:
            stale = age >= creation_grace
        elif alive is None:
            stale = age >= ttl
        else:
            stale = not alive
        if not stale:
            return 1

        quarantine = Path(f"{lock_dir}.stale.{os.getpid()}.{secrets.token_hex(8)}")
        os.rename(lock_dir, quarantine)
        quarantined_owner = quarantine / "owner"
        if quarantined_owner.is_file() and not quarantined_owner.is_symlink():
            quarantined_owner.unlink()
        try:
            quarantine.rmdir()
        except OSError:
            print(f"site_lock: isolated stale lock needs manual inspection: {quarantine}", file=sys.stderr)
        return 0
    finally:
        os.close(descriptor)


def release_lock(lock_dir, token):
    if not token:
        return 2
    descriptor = open_guard(lock_dir, nonblocking=False)
    try:
        if not safe_lock_dir(lock_dir):
            return 1
        owner_path = lock_dir / "owner"
        values = owner_values(owner_path)
        if values.get("token") != token:
            return 1
        owner_path.unlink()
        lock_dir.rmdir()
        return 0
    except OSError as error:
        print(f"site_lock: failed to release {lock_dir}: {error}", file=sys.stderr)
        return 2
    finally:
        os.close(descriptor)


def main():
    args = parse_args()
    try:
        if args.command == "reclaim":
            return reclaim_lock(args.lock_dir, args.ttl, args.creation_grace)
        return release_lock(args.lock_dir, args.token)
    except OSError as error:
        print(f"site_lock: lock operation failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
