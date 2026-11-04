"""Manage the native localhost worker without changing the Docker application."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
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
        print(json.dumps({**capabilities(root), 'ffmpegAvailable': bool(shutil.which('ffmpeg')), 'tokenPresent': (root/'token').is_file()}, indent=2))
    elif args.command == 'prepare':
        from .native import prepare
        prepare(root, args.model)
        print('Model prepared for offline inference.')
    elif args.command == 'serve':
        import uvicorn
        from .worker import create_app
        uvicorn.run(create_app(root), host='127.0.0.1', port=6421, access_log=False)
    elif args.command == 'start':
        if not (root/'token').is_file():
            parser.error('Run init first.')
        with (root/'worker.log').open('a') as log:
            process = subprocess.Popen([sys.executable, '-m', 'voice_transcription.cli', 'serve', '--root', str(root)], stdout=log, stderr=log, start_new_session=True)
        print(f'Worker starting (PID {process.pid}); run doctor and check worker.log for readiness.')
    elif args.command == 'stop':
        request = urllib.request.Request('http://127.0.0.1:6421/v1/shutdown', method='POST', headers={'Authorization':'Bearer '+(root/'token').read_text().strip()})
        with urllib.request.urlopen(request, timeout=5) as response:
            print('Worker stopping.' if response.status==200 else 'Worker stop failed.')

if __name__ == '__main__':
    main()
