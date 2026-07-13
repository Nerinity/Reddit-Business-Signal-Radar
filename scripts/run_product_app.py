#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
NEXT_APP_DIR = REPO_ROOT / "apps" / "next"


def run_command(command: list[str], cwd: Path = REPO_ROOT) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def require_package_manager() -> tuple[str, str]:
    for name in ("npm", "pnpm", "yarn"):
        executable = shutil.which(name)
        if executable:
            return name, executable
    pnpm = "/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm"
    if Path(pnpm).exists():
        return "pnpm", pnpm
    raise SystemExit(
        "No Node package manager was found. Install npm/pnpm/yarn first, then rerun this script."
    )


def run_pm(pm_name: str, pm: str, args: list[str]) -> None:
    if pm_name == "yarn" and args[:1] == ["run"]:
        run_command([pm, *args[1:]], cwd=NEXT_APP_DIR)
    else:
        run_command([pm, *args], cwd=NEXT_APP_DIR)


def require_node_toolchain() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        bundled_node = "/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
        if Path(bundled_node).exists():
            node_bin = str(Path(bundled_node).parent)
            existing_path = os.environ.get("PATH", "")
            os.environ["PATH"] = f"{node_bin}:{existing_path}"
        else:
            raise SystemExit(
                "node was not found on PATH. Install Node.js first, then rerun this script."
            )
    try:
        return require_package_manager()
    except SystemExit:
        raise SystemExit(
            "A Node package manager was not found. Install npm/pnpm/yarn first, then rerun this script."
        )


def sync_data(processed_dir: str) -> None:
    run_command([
        sys.executable,
        "scripts/sync_product_app_data.py",
        "--processed-dir",
        processed_dir,
    ])


def install_deps(pm_name: str, pm: str) -> None:
    package_lock = NEXT_APP_DIR / "package-lock.json"
    pnpm_lock = NEXT_APP_DIR / "pnpm-lock.yaml"
    yarn_lock = NEXT_APP_DIR / "yarn.lock"
    if pm_name == "npm" and package_lock.exists():
        run_command([pm, "ci"], cwd=NEXT_APP_DIR)
    elif pm_name == "pnpm" and pnpm_lock.exists():
        run_command([pm, "install", "--frozen-lockfile"], cwd=NEXT_APP_DIR)
    elif pm_name == "yarn" and yarn_lock.exists():
        run_command([pm, "install", "--frozen-lockfile"], cwd=NEXT_APP_DIR)
    else:
        run_command([pm, "install"], cwd=NEXT_APP_DIR)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run or build the React / Next.js product app.")
    parser.add_argument(
        "command",
        choices=["dev", "build", "start", "lint"],
        nargs="?",
        default="dev",
        help="Next.js command to run.",
    )
    parser.add_argument("--processed-dir", default="data/processed")
    parser.add_argument("--skip-data-sync", action="store_true")
    parser.add_argument(
        "--install",
        action="store_true",
        help="Run npm install/npm ci before the app command.",
    )
    args = parser.parse_args()

    if not NEXT_APP_DIR.exists():
        raise SystemExit(f"Next.js app directory not found: {NEXT_APP_DIR}")

    if not args.skip_data_sync:
        sync_data(args.processed_dir)

    pm_name, pm = require_node_toolchain()
    if args.install or not (NEXT_APP_DIR / "node_modules").exists():
        install_deps(pm_name, pm)

    run_pm(pm_name, pm, ["run", args.command])


if __name__ == "__main__":
    main()
