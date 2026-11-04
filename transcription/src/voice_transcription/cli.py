"""Manage the native localhost worker without changing the Docker application."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import socket
import time
import urllib.error
import urllib.request
from .catalog import capabilities


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init','start','serve','stop','doctor','prepare'])
    parser.add_argument('--root', type=Path, default=Path(os.environ.get('TRANSCRIPTION_WORKER_ROOT', 'storage/transcription-worker')))
    parser.add_argument('--model', default='parakeet-mlx')
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == 'init':
        root.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(root/'token', os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, 'w') as handle:
                handle.write(secrets.token_urlsafe(48))
        print('Worker initialized. Configure the API token file; the token is never printed.')
    elif args.command == 'doctor':
        live = live_capabilities(root)
        print(json.dumps({**capabilities(root), 'workerReachable':live is not None, 'workerCompatible':bool(live and live.get('protocolVersion')==1), 'ffmpegAvailable': bool(shutil.which('ffmpeg')), 'tokenPresent': (root/'token').is_file()}, indent=2))
    elif args.command == 'prepare':
        from .native import prepare
        prepare(root, args.model)
        print('Model prepared for offline inference.')
    elif args.command == 'serve':
        import uvicorn
        from .worker import create_app
        try:
            app = create_app(root)
        except ValueError:
            parser.error('Run init first to create a valid worker authentication token.')
        uvicorn.run(app, host='127.0.0.1', port=6421, access_log=False)
    elif args.command == 'start':
        if not (root/'token').is_file():
            parser.error('Run init first.')
        if live_capabilities(root) is not None:
            print('Worker is already running.')
            return
        try:
            with socket.create_connection(('127.0.0.1',6421),timeout=1):
                parser.error('Port 6421 is already in use by another worker or service.')
        except OSError:
            pass
        with (root/'worker.log').open('a') as log:
            process = subprocess.Popen([sys.executable, '-m', 'voice_transcription.cli', 'serve', '--root', str(root)], stdout=log, stderr=log, start_new_session=True)
        for _ in range(50):
            if live_capabilities(root) is not None:
                print(f'Worker ready on 127.0.0.1:6421 (PID {process.pid}).')
                return
            if process.poll() is not None:
                parser.error('Worker failed to start; check its runtime worker.log.')
            time.sleep(.1)
        parser.error('Worker startup is not yet confirmed; check doctor and worker.log before retrying.')
    elif args.command == 'stop':
        try:
            token = (root/'token').read_text().strip()
            request = urllib.request.Request('http://127.0.0.1:6421/v1/shutdown', method='POST', headers={'Authorization':'Bearer '+token})
            with urllib.request.urlopen(request, timeout=5) as response:
                if response.status != 200:
                    parser.error('Worker rejected shutdown; check worker.log.')
        except OSError:
            parser.error('Could not confirm worker shutdown. Check token initialization, worker availability, and retry.')
        # Shutdown is scheduled after the HTTP response. Wait for the listener
        # to close so an immediate start cannot reuse a disappearing worker.
        for _ in range(50):
            try:
                with socket.create_connection(('127.0.0.1',6421),timeout=.2):
                    pass
            except ConnectionRefusedError:
                print('Worker stopped.')
                return
            except OSError:
                pass
            time.sleep(.1)
        parser.error('Shutdown was requested but the worker port is still unavailable for restart; check worker.log.')

def live_capabilities(root: Path):
    try:
        request = urllib.request.Request('http://127.0.0.1:6421/v1/capabilities', headers={'Authorization':'Bearer '+(root/'token').read_text().strip()})
        with urllib.request.urlopen(request, timeout=1) as response:
            return json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
        return None


if __name__ == '__main__':
    main()
