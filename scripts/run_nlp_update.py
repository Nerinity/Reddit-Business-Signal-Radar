#!/usr/bin/env python3
"""Placeholder NLP update entrypoint.

The crawler is live in this initial scaffold. NLP processing will be wired next
against the parquet raw store and the product taxonomy.
"""
from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["incremental", "full"], default="incremental")
    args = parser.parse_args()
    print(f"NLP update is not implemented yet (mode={args.mode}).")


if __name__ == "__main__":
    main()
