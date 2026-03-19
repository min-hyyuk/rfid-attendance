"""
ACR122U NFC 리더기 — WebSocket 중계 서버

카드를 태그하면 UID를 WebSocket으로 브라우저에 전송합니다.
브라우저(출퇴근 관리 시스템)가 ws://localhost:8765 에 자동 연결됩니다.

설치:
    pip install pyscard websockets

실행:
    python nfc_reader.py

종료: Ctrl+C

Windows 시작 시 자동 실행:
    nfc_autostart.bat 을 시작프로그램 폴더에 넣으세요.
"""

import sys
import json
import time
import asyncio
import threading

try:
    from smartcard.System import readers
    from smartcard.util import toHexString
    from smartcard.Exceptions import NoCardException, CardConnectionException
except ImportError:
    print("[오류] pyscard 라이브러리가 필요합니다.")
    print("       pip install pyscard")
    input("Enter 키를 누르면 종료합니다...")
    sys.exit(1)

try:
    import websockets
    from websockets.asyncio.server import serve
except ImportError:
    print("[오류] websockets 라이브러리가 필요합니다.")
    print("       pip install websockets")
    input("Enter 키를 누르면 종료합니다...")
    sys.exit(1)


# ── 설정 ──────────────────────────────────────────────────
WS_HOST = "localhost"
WS_PORT = 8765
POLL_INTERVAL = 0.3        # 카드 폴링 간격 (초)
DUPLICATE_TIMEOUT = 3.0    # 동일 카드 재태그 무시 시간 (초)
GET_UID_APDU = [0xFF, 0xCA, 0x00, 0x00, 0x00]  # ACR122U UID 읽기 명령

# ── 전역 상태 ─────────────────────────────────────────────
connected_clients = set()
reader_name = None         # 현재 연결된 리더기 이름


def get_reader():
    """연결된 ACR122U 리더기 탐색"""
    try:
        r = readers()
    except Exception:
        return None
    if not r:
        return None
    for rd in r:
        if "ACR122" in str(rd).upper():
            return rd
    return r[0]


def read_uid(connection):
    """카드 UID 읽기 (16진수 문자열 반환)"""
    data, sw1, sw2 = connection.transmit(GET_UID_APDU)
    if sw1 == 0x90 and sw2 == 0x00:
        return toHexString(data).replace(" ", "")
    return None


async def broadcast(message):
    """연결된 모든 브라우저 클라이언트에 메시지 전송"""
    if not connected_clients:
        return
    msg = json.dumps(message, ensure_ascii=False)
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send(msg)
        except Exception:
            dead.add(ws)
    connected_clients -= dead


async def ws_handler(websocket):
    """WebSocket 클라이언트 연결 핸들러"""
    connected_clients.add(websocket)
    client_ip = websocket.remote_address
    print(f"[WS 연결] 브라우저 접속 ({client_ip}) — 현재 {len(connected_clients)}개")

    # 연결 즉시 리더기 상태 전송
    await websocket.send(json.dumps({
        "type": "status",
        "reader": reader_name,
        "connected": reader_name is not None,
    }, ensure_ascii=False))

    try:
        async for _ in websocket:
            pass  # 클라이언트→서버 메시지는 사용하지 않음
    except websockets.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[WS 해제] 브라우저 연결 종료 — 현재 {len(connected_clients)}개")


def card_poll_loop(loop):
    """카드 폴링 스레드 (별도 스레드에서 실행)"""
    global reader_name
    reader = None
    last_uid = None
    last_time = 0

    while True:
        # 리더기 탐색
        if reader is None:
            reader = get_reader()
            if reader:
                reader_name = str(reader)
                print(f"[리더기 연결] {reader_name}")
                asyncio.run_coroutine_threadsafe(
                    broadcast({"type": "status", "reader": reader_name, "connected": True}),
                    loop
                )
            else:
                if reader_name is not None:
                    reader_name = None
                    asyncio.run_coroutine_threadsafe(
                        broadcast({"type": "status", "reader": None, "connected": False}),
                        loop
                    )
                time.sleep(2)
                continue

        # 카드 읽기 시도
        try:
            connection = reader.createConnection()
            connection.connect()
            uid = read_uid(connection)
            connection.disconnect()

            if uid:
                now = time.time()
                if uid == last_uid and (now - last_time) < DUPLICATE_TIMEOUT:
                    pass
                else:
                    last_uid = uid
                    last_time = now
                    print(f"[카드 감지] {uid}")
                    asyncio.run_coroutine_threadsafe(
                        broadcast({"type": "card", "uid": uid}),
                        loop
                    )

        except (NoCardException, CardConnectionException):
            pass
        except Exception as e:
            print(f"[경고] {e}")
            reader = None
            reader_name = None
            asyncio.run_coroutine_threadsafe(
                broadcast({"type": "status", "reader": None, "connected": False}),
                loop
            )
            time.sleep(2)
            continue

        time.sleep(POLL_INTERVAL)


async def main():
    print("=" * 54)
    print("  ACR122U NFC 리더기 — WebSocket 서버")
    print(f"  ws://{WS_HOST}:{WS_PORT}")
    print("=" * 54)
    print()

    loop = asyncio.get_event_loop()

    # 카드 폴링 스레드 시작
    poll_thread = threading.Thread(target=card_poll_loop, args=(loop,), daemon=True)
    poll_thread.start()

    reader = get_reader()
    if reader:
        print(f"[리더기 연결] {reader}")
    else:
        print("[대기] NFC 리더기를 찾는 중... (USB 연결 후 자동 감지)")

    print(f"[서버 시작] 브라우저 연결 대기 중 (ws://localhost:{WS_PORT})")
    print("[종료] Ctrl+C")
    print()

    async with serve(ws_handler, WS_HOST, WS_PORT):
        await asyncio.Future()  # 무한 대기


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[종료] NFC 서버를 종료합니다.")
