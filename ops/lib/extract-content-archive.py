#!/usr/bin/env python3
"""Safely extract a content upload into an empty staging directory."""

import os
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath


MAX_FILES = 20_000
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_PATH_BYTES = 4096
MAX_COMPONENT_BYTES = 255
MAX_PATH_TABLE_BYTES = 8 * 1024 * 1024


def fail(message: str) -> None:
    raise SystemExit(f"extract-content-archive: {message}")


def normalized_parts(name: str) -> tuple[str, ...]:
    if not name or name.startswith("/") or "\\" in name:
        fail(f"invalid archive path: {name!r}")
    if any(ord(character) < 32 or ord(character) == 127 for character in name):
        fail(f"invalid archive path: {name!r}")
    try:
        encoded = name.encode("utf-8")
    except UnicodeEncodeError:
        fail(f"invalid UTF-8 archive path: {name!r}")
    if len(encoded) > MAX_PATH_BYTES:
        fail(f"archive path is too long: {name!r}")

    raw_parts = name.split("/")
    if raw_parts and raw_parts[0] == ".":
        raw_parts = raw_parts[1:]
    parts = tuple(raw_parts)
    path = PurePosixPath(*parts)
    if path.is_absolute() or not parts or any(part in ("", ".", "..") for part in parts):
        fail(f"unsafe archive path: {name!r}")
    if any(len(part.encode("utf-8")) > MAX_COMPONENT_BYTES for part in parts):
        fail(f"archive path component is too long: {name!r}")
    return parts


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: extract-content-archive.py ARCHIVE DESTINATION")

    archive = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    if not archive.is_file() or archive.is_symlink():
        fail("archive must be a regular file")
    if not destination.is_dir() or destination.is_symlink():
        fail("destination must be an existing directory")
    if any(destination.iterdir()):
        fail("destination must be empty")

    seen: set[tuple[str, ...]] = set()
    total_bytes = 0
    total_path_bytes = 0
    with tarfile.open(archive, mode="r:gz") as bundle:
        validated: list[tuple[tarfile.TarInfo, tuple[str, ...]]] = []
        for member in bundle:
            if member.name in (".", "./") and member.isdir():
                continue
            if len(validated) >= MAX_FILES:
                fail("archive contains too many files")
            parts = normalized_parts(member.name)
            total_path_bytes += len(member.name.encode("utf-8"))
            if total_path_bytes > MAX_PATH_TABLE_BYTES:
                fail("archive path table is too large")
            if parts in seen:
                fail(f"duplicate archive path: {member.name}")
            seen.add(parts)
            if not (member.isdir() or member.isfile()):
                fail(f"links and special files are not allowed: {member.name}")
            if member.isfile():
                if member.size < 0 or member.size > MAX_FILE_BYTES:
                    fail(f"invalid or excessive file size: {member.name}")
                if member.name.endswith(".json") and member.size > MAX_JSON_BYTES:
                    fail(f"JSON file is too large: {member.name}")
                total_bytes += member.size
                if total_bytes > MAX_TOTAL_BYTES:
                    fail("expanded content exceeds the extraction limit")
            validated.append((member, parts))

        if not validated:
            fail("archive contains no files")

    with tarfile.open(archive, mode="r:gz") as bundle:
        for member, parts in validated:
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue

            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            source = bundle.extractfile(member)
            if source is None:
                fail(f"cannot read archive member: {member.name}")
            try:
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                fail(f"archive path collides with another member: {member.name}")
            with source, os.fdopen(descriptor, "wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)


if __name__ == "__main__":
    main()
