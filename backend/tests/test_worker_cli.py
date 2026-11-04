from pathlib import Path
import urllib.error
import pytest
from voice_transcription import cli


@pytest.mark.parametrize('initialized',[False,True])
def test_stop_without_running_worker_exits_cleanly(tmp_path,monkeypatch,capsys,initialized):
    if initialized:(tmp_path/'token').write_text('t'*48)
    monkeypatch.setattr('sys.argv',['worker','stop','--root',str(tmp_path)])
    def unavailable(*args,**kwargs):raise urllib.error.URLError('unavailable')
    monkeypatch.setattr(cli.urllib.request,'urlopen',unavailable)
    with pytest.raises(SystemExit) as exc:cli.main()
    assert exc.value.code==2
    assert 'Could not confirm worker shutdown' in capsys.readouterr().err
