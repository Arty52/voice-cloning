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


@pytest.mark.parametrize('closes',[False,True])
def test_stop_waits_for_listener_before_reporting_completion(tmp_path,monkeypatch,capsys,closes):
    from unittest.mock import MagicMock
    (tmp_path/'token').write_text('t'*48)
    monkeypatch.setattr('sys.argv',['worker','stop','--root',str(tmp_path)])
    response=MagicMock();response.__enter__.return_value.status=200
    monkeypatch.setattr(cli.urllib.request,'urlopen',lambda *args,**kwargs:response)
    connection=MagicMock()
    if closes:connection.side_effect=[MagicMock(),ConnectionRefusedError()]
    monkeypatch.setattr(cli.socket,'create_connection',connection)
    monkeypatch.setattr(cli.time,'sleep',lambda seconds:None)
    if closes:
        cli.main()
        assert 'Worker stopped.' in capsys.readouterr().out
        assert connection.call_count==2
    else:
        with pytest.raises(SystemExit) as exc:cli.main()
        assert exc.value.code==2
        assert 'still unavailable for restart' in capsys.readouterr().err
        assert connection.call_count==50
