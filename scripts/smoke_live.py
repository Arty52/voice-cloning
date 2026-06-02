from __future__ import annotations

from http.client import HTTPConnection
from pathlib import Path
from uuid import uuid4


def main() -> None:
    boundary = f"----voice-clone-smoke-{uuid4().hex}"
    body = multipart_body(
        boundary,
        {
            "text": "This is a live smoke test from the local voice clone app using the built-in ElevenLabs provider.",
            "sampleMode": "default",
        },
    )
    connection = HTTPConnection("127.0.0.1", 6420, timeout=180)
    connection.request(
        "POST",
        "/api/speech",
        body=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    response = connection.getresponse()
    content = response.read()
    if response.status != 200:
        raise SystemExit(f"Smoke test failed: {response.status} {content.decode('utf-8', errors='replace')}")

    output_path = Path("/app/storage/smoke-output.mp3")
    output_path.write_bytes(content)
    print(f"Generated {len(content)} bytes at {output_path}")
    print(f"Voice cache: {response.getheader('X-Voice-Cache', 'unknown')}")
    print(f"Voice ID: {response.getheader('X-Voice-Id', 'unknown')}")


def multipart_body(boundary: str, fields: dict[str, str]) -> bytes:
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunks.append(value.encode())
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks)


if __name__ == "__main__":
    main()
