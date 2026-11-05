import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import uuid
RUNTIME = Path(__file__).resolve().parents[1] / "claude-consult"
sys.path.insert(0, str(RUNTIME))
import run_control as rc

WORKER = r'''
import fcntl,json,os,sys
from pathlib import Path
sys.path.insert(0, sys.argv[5])
import run_control as rc
rc.BASE=Path(sys.argv[1])
control=json.loads(sys.argv[2])
script=sys.argv[3]
with open(sys.argv[4],"a") as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    lease=rc.Lease(control)
    outcome,output=rc.run([sys.executable,"-c",script],os.environ.copy(),cwd=Path.home(),
        text="",timeout=40,lease=lease,lock_fd=lock.fileno())
    print(json.dumps({"outcome":outcome,"output":output}),flush=True)
'''
def wait_for(fn,timeout=10):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        result=fn()
        if result:return result
        time.sleep(.05)
    raise AssertionError("condition timed out")

with tempfile.TemporaryDirectory(prefix="claude-stop-test-") as tmp:
    rc.BASE=Path(tmp)/"runs"
    owned=[]
    results={}
    def start(script="import time; time.sleep(35)",key=None,run=None):
        control={"key":key or str(uuid.uuid4()),"runId":run or str(uuid.uuid4())}
        lock=Path(tmp)/(control["runId"]+".lock")
        child=subprocess.Popen([sys.executable,"-u","-c",WORKER,str(rc.BASE),json.dumps(control),script,str(lock),str(RUNTIME)],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        owned.append(child)
        child.stdin.write("ping\n");child.stdin.flush()
        return child,control,lock
    def running(control):
        info=rc.state(rc.run_dir(control))
        return info if info and info.get("pid") else None
    def finish(child,timeout=10):
        child.wait(timeout=timeout)
        out=child.stdout.read();err=child.stderr.read()
        assert child.returncode==0,(child.returncode,err)
        return json.loads(out)
    try:
        p,c,_=start("print('completed')")
        done=finish(p)
        assert done["outcome"]["status"]=="finished" and done["output"][1].strip()=="completed"
        results["normal_completion"]=True

        p,c,_=start()
        info=wait_for(lambda:running(c))
        p.stdin.write("cancel\n");p.stdin.flush()
        done=finish(p)
        assert done["outcome"]["status"]=="cancelled" and done["outcome"]["remoteExited"]
        assert not rc.group_alive(info["pid"])
        results["cancel_frame"]=True

        p,c,_=start()
        info=wait_for(lambda:running(c))
        p.stdin.close()
        done=finish(p)
        assert done["outcome"]["status"]=="connection_lost"
        assert not rc.group_alive(info["pid"])
        results["connection_eof"]=True

        p,c,_=start()
        info=wait_for(lambda:running(c))
        rc.cancel(c)
        done=finish(p)
        assert done["outcome"]["status"]=="cancelled"
        results["out_of_band_cancel"]=True

        p,c,_=start()
        info=wait_for(lambda:running(c))
        start_time=time.monotonic()
        done=finish(p,25)
        assert done["outcome"]["status"]=="lease_expired"
        assert time.monotonic()-start_time<22
        results["heartbeat_expiry"]=True

        script="import subprocess,sys,time,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(35)']); time.sleep(35)"
        p,c,lock=start(script)
        info=wait_for(lambda:running(c))
        time.sleep(.6)
        p.kill();p.wait(timeout=3)
        wait_for(lambda:rc.status(c).get("remoteExited"),10)
        assert not rc.group_alive(info["pid"])
        with lock.open("a") as handle:
            fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        results["helper_killed_child_group_reaped_and_lock_released"]=True

        key=str(uuid.uuid4());old={"key":key,"runId":str(uuid.uuid4())}
        rc.cancel(old)
        p,c,_=start("import time; time.sleep(1); print('new run')",key=key)
        info=wait_for(lambda:running(c))
        rc.cancel(old)
        done=finish(p)
        assert done["outcome"]["status"]=="finished"
        results["old_cancel_does_not_kill_new_run"]=True

        first,c1,_=start()
        second,c2,_=start("import time; time.sleep(2); print('other')")
        wait_for(lambda:running(c1));wait_for(lambda:running(c2))
        rc.cancel(c1)
        assert finish(first)["outcome"]["status"]=="cancelled"
        assert finish(second)["outcome"]["status"]=="finished"
        results["other_conversation_isolation"]=True

        c={"key":str(uuid.uuid4()),"runId":str(uuid.uuid4())}
        rc.cancel(c)
        p,_,_=start(key=c["key"],run=c["runId"])
        done=finish(p)
        assert done["outcome"]["status"]=="cancelled" and done["output"] is None
        results["cancel_before_launch"]=True
    finally:
        for child in owned:
            if child.poll() is None:
                child.stdin.close()
                try:child.wait(timeout=8)
                except subprocess.TimeoutExpired:child.kill();child.wait()
    print(json.dumps({"passed":results}))
