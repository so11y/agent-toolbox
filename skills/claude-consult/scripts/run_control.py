"""Run-scoped cancellation and bounded transport leases. Never accepts a caller PID."""
import json
import os
from pathlib import Path
import signal
import select
import subprocess
import sys
import threading
import time
import uuid

BASE = Path.home()/".cache/project-consult/runs"
LEASE_SECONDS = 15
GRACE_SECONDS = 3

def run_dir(control):
    key, run = str(uuid.UUID(control["key"])), str(uuid.UUID(control["runId"]))
    target = BASE/key/run
    if any(p.is_symlink() for p in (BASE, BASE/key, target)):
        raise ValueError("Unexpected run path.")
    target.mkdir(parents=True,exist_ok=True,mode=0o700)
    return target

def write_json(path, value):
    temporary=path.with_name(path.name+"."+str(os.getpid())+".tmp")
    temporary.write_text(json.dumps(value),encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)

def birth(pid):
    try:
        return Path("/proc",str(pid),"stat").read_text().rsplit(")",1)[1].split()[19]
    except (FileNotFoundError,ProcessLookupError):
        return None

def group_alive(pgid):
    # Zombies no longer execute and will be reaped by the owning helper/init.
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            fields=(proc/"stat").read_text().rsplit(")",1)[1].split()
            if fields[0] != "Z" and int(fields[2]) == pgid:
                return True
        except (FileNotFoundError,PermissionError,ProcessLookupError):
            pass
    return False

def terminate_group(pgid):
    for sig, grace in ((signal.SIGTERM,GRACE_SECONDS),(signal.SIGKILL,2)):
        try:
            os.killpg(pgid,sig)
        except ProcessLookupError:
            return True
        end=time.monotonic()+grace
        while time.monotonic()<end:
            if not group_alive(pgid):
                return True
            time.sleep(0.1)
    return not group_alive(pgid)

def state(directory):
    p=directory/"state.json"
    return json.loads(p.read_text()) if p.exists() else None

def cancellation_reason(directory):
    p=directory/"cancel.json"
    if p.exists():
        return json.loads(p.read_text()).get("reason","cancelled")
    return None

def cancel(control, reason="cancelled"):
    directory=run_dir(control)
    write_json(directory/"cancel.json",{"reason":reason})
    current=state(directory)
    if not current:
        return {"status":"cancelled","remoteExited":True,"runId":control["runId"]}
    return status(control)

def status(control):
    directory=run_dir(control)
    current=state(directory)
    if not current:
        return {"status":"cancelled" if cancellation_reason(directory) else "not_found",
                "remoteExited":bool(cancellation_reason(directory)),"runId":control["runId"]}
    terminal=current["status"] in ("finished","cancelled","connection_lost","lease_expired","timeout","helper_exited")
    return {**current,"remoteExited":terminal and not group_alive(current.get("pid",-1))}

class Lease:
    def __init__(self,control):
        self.control=control
        self.directory=run_dir(control)
        self.last=time.monotonic()
        self.reason=None
        self.done=threading.Event()
        write_json(self.directory/"lease.json",{"at":self.last})
        self.reader=threading.Thread(target=self.read,daemon=True)
        self.reader.start()
    def read(self):
        pending=b""
        while not self.done.is_set():
            if not select.select([0],[],[],0.25)[0]:
                continue
            chunk=os.read(0,4096)
            if self.done.is_set():
                return
            if not chunk:
                self.reason="connection_lost"
                cancel(self.control,self.reason)
                return
            pending+=chunk
            while b"\n" in pending:
                line,pending=pending.split(b"\n",1)
                if line==b"ping":
                    self.last=time.monotonic()
                    write_json(self.directory/"lease.json",{"at":self.last})
                elif line==b"cancel":
                    self.reason="cancelled"
                    cancel(self.control)
                    return
                else:
                    self.reason="connection_lost"
                    cancel(self.control,self.reason)
                    return
            if len(pending)>256:
                self.reason="connection_lost"
                cancel(self.control,self.reason)
                return
    def check(self):
        return cancellation_reason(self.directory) or self.reason or (
            "lease_expired" if time.monotonic()-self.last>LEASE_SECONDS else None)

def guard(directory, parent, parent_birth, child, child_birth):
    # Inherits the project's flock fd, so orphan cleanup remains mutually exclusive.
    directory=Path(directory)
    while True:
        current=state(directory)
        if current and current["status"] in ("finished","cancelled","connection_lost","lease_expired","timeout","helper_exited"):
            return
        reason=cancellation_reason(directory)
        if birth(parent)!=parent_birth:
            reason=reason or "helper_exited"
        lease=json.loads((directory/"lease.json").read_text())
        if time.monotonic()-lease["at"]>LEASE_SECONDS:
            reason=reason or "lease_expired"
        if reason:
            if birth(child) not in (None,child_birth):
                return
            exited=terminate_group(child)
            # The normal helper records its own result. Take over only if it died.
            if birth(parent)!=parent_birth and current:
                current.update(status=reason,remoteExited=exited)
                write_json(directory/"state.json",current)
            return
        if not group_alive(child):
            return
        time.sleep(0.25)

def run(args,env,*,cwd,text,timeout,lease,lock_fd):
    directory=lease.directory
    reason=lease.check()
    if reason:
        return {"status":reason,"remoteExited":True,"runId":lease.control["runId"]},None
    child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),"--child",str(os.getpid()),*args],cwd=cwd,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True,start_new_session=True)
    record={"runId":lease.control["runId"],"status":"running","pid":child.pid,
            "birth":birth(child.pid),"helperPid":os.getpid(),"helperBirth":birth(os.getpid())}
    write_json(directory/"state.json",record)
    guardian=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),"--guard",str(directory),
        str(os.getpid()),record["helperBirth"],str(child.pid),record["birth"]],
        stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
        start_new_session=True,pass_fds=(lock_fd,))
    started=time.monotonic()
    first=True
    try:
        while True:
            reason=lease.check()
            if time.monotonic()-started>timeout:
                reason=reason or "timeout"
            if reason:
                exited=terminate_group(child.pid)
                stdout,stderr=child.communicate()
                record.update(status=reason,remoteExited=exited)
                write_json(directory/"state.json",record)
                return {**record,"remoteExited":exited},None
            try:
                stdout,stderr=child.communicate(text if first else None,timeout=0.25)
                first=False
                reason=lease.check()
                # Even successful output is discarded when cancellation won the race.
                record.update(status=reason or "finished",remoteExited=True)
                write_json(directory/"state.json",record)
                if reason:
                    return record,None
                return record,(child.returncode,stdout,stderr)
            except subprocess.TimeoutExpired:
                first=False
    finally:
        if child.poll() is None or group_alive(child.pid):
            terminate_group(child.pid)
            child.communicate()
        lease.done.set()
        try: guardian.wait(timeout=6)
        except subprocess.TimeoutExpired:
            guardian.terminate()
            guardian.wait(timeout=3)

if __name__=="__main__" and len(sys.argv)>1 and sys.argv[1]=="--guard":
    guard(sys.argv[2],int(sys.argv[3]),sys.argv[4],int(sys.argv[5]),sys.argv[6])

if __name__=="__main__" and len(sys.argv)>1 and sys.argv[1]=="--child":
    import ctypes
    if ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGTERM,0,0,0)!=0:
        raise OSError(ctypes.get_errno(),"Cannot bind child lifetime")
    if os.getppid()!=int(sys.argv[2]):
        sys.exit(125)
    os.execvpe(sys.argv[3],sys.argv[3:],os.environ)
