#!/usr/bin/env python3
"""Local API launcher for this sandbox — parses .env with dotenv semantics
(double-quoted \\n escapes become real newlines) then execs node dist/main.js.
Plain `source .env` corrupts the multi-line JWT_PRIVATE_KEY (bash keeps literal
\\n), which crashes POST /auth/login with asn1 'header too long'. Not part of
the product; untracked convenience for the arena session only."""
import os
import sys

ENV_PATH = "/home/user/ERP_Cloud/.env"
API_DIR = "/home/user/ERP_Cloud/apps/api"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    with open(ENV_PATH, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
                value = (
                    value[1:-1]
                    .replace("\\n", "\n")
                    .replace('\\"', '"')
                    .replace("\\\\", "\\")
                )
            elif len(value) >= 2 and value[0] == "'" and value[-1] == "'":
                value = value[1:-1]
            env[key] = value
    return env


def main() -> None:
    os.chdir(API_DIR)
    os.environ.update(load_env())
    os.execvp("node", ["node", "dist/main.js"])


if __name__ == "__main__":
    sys.exit(main())
