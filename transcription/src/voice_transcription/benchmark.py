"""Capture local worker output and timings for the private evaluation corpus."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import threading
import time
import urllib.request
import uuid


def process_tree_rss(pid: int) -> int:
    """Sample resident memory of the worker and its supervised children (macOS/Linux)."""
    rows = [tuple(map(int,line.split())) for line in subprocess.check_output(
        ['ps','-A','-o','pid=,ppid=,rss='],text=True).splitlines() if line.strip()]
    descendants={pid}
    for _ in range(len(rows)):
        found={child for child,parent,_ in rows if parent in descendants}
        if found <= descendants: break
        descendants.update(found)
    return sum(rss*1024 for child,_,rss in rows if child in descendants)


def capture(root: Path, audio: Path, engine: str, language: str, detect_speakers: bool,
            worker_pid: int | None = None) -> dict:
    headers={'Authorization':'Bearer '+(root/'token').read_text().strip()}
    job_id=uuid.uuid4().hex
    def request(path, method='GET', payload=None, extra=None):
        with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:6421'+path,
                method=method,data=payload,headers={**headers,**(extra or {})}),timeout=60) as response:
            return json.load(response)
    peak=0
    memory_failed=False
    done=threading.Event()
    def sample_memory():
        nonlocal peak,memory_failed
        while not done.is_set():
            try: peak=max(peak, process_tree_rss(worker_pid))
            except (OSError,ValueError,subprocess.SubprocessError): memory_failed=True
            done.wait(.25)
    sampler=threading.Thread(target=sample_memory,daemon=True) if worker_pid else None
    if sampler: sampler.start()
    started=time.perf_counter()
    try:
        from urllib.parse import urlencode
        query=urlencode({'engineId':engine,'language':language,'detectSpeakers':str(detect_speakers).lower()})
        request('/v1/jobs?'+query,'POST',audio.read_bytes(),{'Content-Type':'audio/wav','Idempotency-Key':job_id})
        while time.perf_counter()-started < 3600:
            job=request('/v1/jobs/'+job_id)
            if job['status']=='success':
                result=job['result']
                # Worker time covers inference stages, not API normalization or audio extraction.
                result['worker_seconds']=result.pop('total_seconds',None)
                result['http_seconds']=time.perf_counter()-started
                result['total_seconds']=None
                result['peak_rss_bytes']=peak if sampler and not memory_failed else None
                result['stages']=job['stages']
                result['turns']=(result.get('diarization') or {}).get('turns',[])
                attribution=(result.get('diarization') or {}).get('exclusive_turns',[])
                for word in result['words']:
                    overlaps=[(max(0.,min(word['end_seconds'],turn['end_seconds'])-max(word['start_seconds'],turn['start_seconds'])),turn['speaker_label']) for turn in attribution]
                    word['speaker_label']=max(overlaps)[1] if overlaps and max(overlaps)[0]>0 else None
                return result
            if job['status'] in ('error','canceled'):
                raise RuntimeError(job['error'])
            time.sleep(.25)
        raise TimeoutError('Worker benchmark timed out.')
    finally:
        done.set()
        if sampler: sampler.join(2)
        try: request('/v1/jobs/'+job_id,'DELETE')
        except OSError: pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio',type=Path,help='Normalized mono 16 kHz PCM16 WAV')
    parser.add_argument('--root',type=Path,default=Path('storage/transcription-worker'))
    parser.add_argument('--engine',choices=['parakeet-mlx','whisper-mlx'],required=True)
    parser.add_argument('--language',default='en')
    parser.add_argument('--detect-speakers',action='store_true')
    parser.add_argument('--worker-pid',type=int)
    parser.add_argument('--output',type=Path,required=True,help='Private raw hypothesis JSON; keep outside Git')
    args=parser.parse_args()
    result=capture(args.root,args.audio,args.engine,args.language,args.detect_speakers,args.worker_pid)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({key:result.get(key) for key in ('engine','asr_seconds','worker_seconds','http_seconds','peak_rss_bytes')}))

if __name__=='__main__':
    main()
