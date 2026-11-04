from unittest.mock import patch
from voice_transcription.benchmark import process_tree_rss


def test_peak_memory_includes_descendants_but_no_unrelated_processes():
    with patch('subprocess.check_output',return_value='10 1 100\n11 10 200\n12 11 300\n13 1 900\n'):
        assert process_tree_rss(10)==600*1024
