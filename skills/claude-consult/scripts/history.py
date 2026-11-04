#!/usr/bin/env python3
"""A Japanese conversation picker; no model call until the user submits a message."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from remote_review import CACHE_BASE, history_read, history_save, project_lock, runtime, session_transcript

def records():
    folder = CACHE_BASE / "conversations"
    return sorted((json.loads(p.read_text(encoding="utf-8")) for p in folder.glob("*.json")),
                  key=lambda x:x["updatedAt"], reverse=True)

def open_session(key):
    record = history_read(key)
    if not record or session_transcript(record["sessionId"]) is None:
        print("保存された会話が見つかりません。")
        return 1
    with project_lock(record["projectId"]) as acquired:
        if not acquired:
            print("このプロジェクトは実行中です。完了後に開いてください。")
            return 2
        record["paused"] = True
        history_save(record)
        cwd = Path(record["workingDirectory"])
        if not cwd.is_dir():
            cwd = CACHE_BASE / "history" / record["key"]
            cwd.mkdir(parents=True,exist_ok=True,mode=0o700)
            print("作業用ファイルは整理済みです。履歴を開きます。次の分析前に資料の再同期が必要です。")
        print("自動処理は一時停止中です。終了後、元のチャットで続行を依頼してください。")
        config = json.loads((Path(__file__).parent/"history-config.json").read_text(encoding="utf-8"))
        binary, env = runtime(config["proxy"])
        if not binary:
            print("Claude Code が見つかりません。")
            return 1
        return subprocess.call([binary,"--resume",record["sessionId"],"--restricted","--safe-mode",
            "--tools","Read,Grep,Glob","--allowedTools","Read,Grep,Glob","--disallowedTools","mcp__*",
            "--strict-mcp-config","--mcp-config",'{"mcpServers":{}}',"--permission-mode","dontAsk"],
            cwd=cwd,env=env)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--key")
    parser.add_argument("--list-json",action="store_true")
    args = parser.parse_args()
    if args.list_json:
        print(json.dumps(records(),ensure_ascii=False))
        return 0
    if args.key:
        return open_session(args.key)
    items = records()
    print("\n会話履歴\n")
    if not items:
        print("まだ保存された会話はありません。")
        input("\nEnter で閉じる")
        return 0
    for index,record in enumerate(items,1):
        print(f'{index}. {record["title"]}  {record["updatedAt"][:16]}')
    choice = input("\n開く番号（空欄で終了）: ").strip()
    if not choice:
        return 0
    if not choice.isdecimal() or not 1 <= int(choice) <= len(items):
        print("一覧の番号を入力してください。")
        return 1
    return open_session(items[int(choice)-1]["key"])

if __name__ == "__main__":
    sys.exit(main())
