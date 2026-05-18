"""通过 paramiko + 凭据文件执行远程命令 / 上传文件。

用法：
  python scripts/remote_ssh.py run "uname -a"
  python scripts/remote_ssh.py run-file path/to/local_script.sh   # 远端 bash -lc <脚本内容>
  python scripts/remote_ssh.py put local_path remote_path
  python scripts/remote_ssh.py get remote_path local_path
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import paramiko

CRED_FILE = Path(__file__).with_name(".remote-credentials.json")


def _load_credentials() -> dict:
    if not CRED_FILE.exists():
        sys.exit(f"missing {CRED_FILE}")
    return json.loads(CRED_FILE.read_text(encoding="utf-8"))


def _client(cred: dict) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=cred["host"],
        port=int(cred.get("port", 22)),
        username=cred["username"],
        password=cred["password"],
        timeout=20,
        banner_timeout=20,
        auth_timeout=20,
        allow_agent=False,
        look_for_keys=False,
    )
    return client


def cmd_run(cred: dict, command: str, *, timeout: int = 600) -> int:
    client = _client(cred)
    try:
        chan = client.get_transport().open_session()
        chan.get_pty()
        chan.exec_command(command)
        chan.settimeout(timeout)
        buf_out = b""
        while True:
            if chan.recv_ready():
                data = chan.recv(65536)
                if not data:
                    break
                buf_out += data
                sys.stdout.buffer.write(data)
                sys.stdout.flush()
            if chan.exit_status_ready() and not chan.recv_ready():
                break
        # drain
        while chan.recv_ready():
            data = chan.recv(65536)
            buf_out += data
            sys.stdout.buffer.write(data)
            sys.stdout.flush()
        code = chan.recv_exit_status()
        return code
    finally:
        client.close()


def cmd_run_file(cred: dict, path: str, *, timeout: int = 600) -> int:
    p = Path(path)
    if not p.exists():
        sys.exit(f"missing local file: {p}")
    body = p.read_text(encoding="utf-8")
    client = _client(cred)
    try:
        sftp = client.open_sftp()
        remote = f"/tmp/{p.name}.{os.getpid()}.sh"
        with sftp.file(remote, "w") as f:
            f.write(body)
        sftp.chmod(remote, 0o755)
        sftp.close()
        chan = client.get_transport().open_session()
        chan.get_pty()
        chan.exec_command(f"bash -lc 'bash {remote}; rc=$?; rm -f {remote}; exit $rc'")
        chan.settimeout(timeout)
        while True:
            if chan.recv_ready():
                data = chan.recv(65536)
                if not data:
                    break
                sys.stdout.buffer.write(data)
                sys.stdout.flush()
            if chan.exit_status_ready() and not chan.recv_ready():
                break
        while chan.recv_ready():
            data = chan.recv(65536)
            sys.stdout.buffer.write(data)
            sys.stdout.flush()
        return chan.recv_exit_status()
    finally:
        client.close()


def cmd_put(cred: dict, local: str, remote: str) -> int:
    client = _client(cred)
    try:
        sftp = client.open_sftp()
        sftp.put(local, remote)
        sftp.close()
        print(f"PUT {local} -> {remote}")
        return 0
    finally:
        client.close()


def cmd_get(cred: dict, remote: str, local: str) -> int:
    client = _client(cred)
    try:
        sftp = client.open_sftp()
        sftp.get(remote, local)
        sftp.close()
        print(f"GET {remote} -> {local}")
        return 0
    finally:
        client.close()


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cred = _load_credentials()
    action = sys.argv[1]
    if action == "run":
        return cmd_run(cred, " ".join(sys.argv[2:]))
    if action == "run-file":
        if len(sys.argv) < 3:
            sys.exit("run-file needs <local_path>")
        return cmd_run_file(cred, sys.argv[2])
    if action == "put":
        if len(sys.argv) < 4:
            sys.exit("put needs <local> <remote>")
        return cmd_put(cred, sys.argv[2], sys.argv[3])
    if action == "get":
        if len(sys.argv) < 4:
            sys.exit("get needs <remote> <local>")
        return cmd_get(cred, sys.argv[2], sys.argv[3])
    sys.exit(f"unknown action: {action}")


if __name__ == "__main__":
    raise SystemExit(main())
