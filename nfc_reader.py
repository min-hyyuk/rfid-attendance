"""
ACR122U NFC Reader - WebSocket Server

Reads NFC card UID via Windows winscard.dll (no pyscard needed)
and sends it to the browser via WebSocket (ws://localhost:8765).

Requirements: pip install websockets
"""

import sys
import json
import time
import ctypes
import ctypes.wintypes as wt
import asyncio
import threading

# ── websockets import ────────────────────────────────────
try:
    import websockets
    from websockets.asyncio.server import serve
except ImportError:
    print("[ERROR] websockets library required.")
    print("        pip install websockets")
    input("Press Enter to exit...")
    sys.exit(1)

# ── WinSCard API (ctypes) ────────────────────────────────
_winscard = ctypes.windll.winscard

SCARD_SCOPE_USER       = 0
SCARD_SHARE_SHARED     = 2
SCARD_PROTOCOL_T0      = 1
SCARD_PROTOCOL_T1      = 2
SCARD_LEAVE_CARD       = 0
SCARD_S_SUCCESS        = 0
SCARD_E_NO_READERS     = 0x8010002E
SCARD_E_NO_SMARTCARD   = 0x8010000C
SCARD_E_TIMEOUT        = 0x8010000A
SCARD_AUTOALLOCATE     = 0xFFFFFFFF

class SCARD_IO_REQUEST(ctypes.Structure):
    _fields_ = [("dwProtocol", wt.DWORD), ("cbPciLength", wt.DWORD)]

g_rgSCardT1Pci = SCARD_IO_REQUEST(SCARD_PROTOCOL_T1, 8)
g_rgSCardT0Pci = SCARD_IO_REQUEST(SCARD_PROTOCOL_T0, 8)


def scard_establish():
    hContext = wt.HANDLE()
    ret = _winscard.SCardEstablishContext(
        SCARD_SCOPE_USER, None, None, ctypes.byref(hContext))
    if ret != SCARD_S_SUCCESS:
        return None
    return hContext.value


def scard_list_readers(hContext):
    buf = ctypes.c_char_p()
    buflen = wt.DWORD(SCARD_AUTOALLOCATE)
    ret = _winscard.SCardListReadersA(
        hContext, None, ctypes.byref(buf), ctypes.byref(buflen))
    if ret != SCARD_S_SUCCESS:
        return []
    raw = ctypes.string_at(buf, buflen.value)
    _winscard.SCardFreeMemory(hContext, buf)
    readers = []
    for name in raw.split(b'\x00'):
        if name:
            readers.append(name.decode('ascii', errors='replace'))
    return readers


def scard_connect(hContext, reader_name):
    hCard = wt.HANDLE()
    dwProtocol = wt.DWORD()
    ret = _winscard.SCardConnectA(
        hContext, reader_name.encode('ascii'),
        SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
        ctypes.byref(hCard), ctypes.byref(dwProtocol))
    if ret != SCARD_S_SUCCESS:
        return None, 0
    return hCard.value, dwProtocol.value


def scard_transmit(hCard, protocol, apdu_bytes):
    pci = g_rgSCardT1Pci if protocol == SCARD_PROTOCOL_T1 else g_rgSCardT0Pci
    send_buf = (ctypes.c_ubyte * len(apdu_bytes))(*apdu_bytes)
    recv_buf = (ctypes.c_ubyte * 260)()
    recv_len = wt.DWORD(260)
    ret = _winscard.SCardTransmit(
        hCard, ctypes.byref(pci), send_buf, len(apdu_bytes),
        None, recv_buf, ctypes.byref(recv_len))
    if ret != SCARD_S_SUCCESS:
        return None, 0, 0
    data = bytes(recv_buf[:recv_len.value])
    if len(data) >= 2:
        return data[:-2], data[-2], data[-1]
    return data, 0, 0


def scard_disconnect(hCard):
    _winscard.SCardDisconnect(hCard, SCARD_LEAVE_CARD)


def scard_release(hContext):
    _winscard.SCardReleaseContext(hContext)


# ── NFC Reader Logic ─────────────────────────────────────
GET_UID_APDU = [0xFF, 0xCA, 0x00, 0x00, 0x00]

def find_reader(hContext):
    readers = scard_list_readers(hContext)
    for r in readers:
        if 'ACR122' in r.upper() or 'ACR' in r.upper():
            return r
    return readers[0] if readers else None


def read_uid(hContext, reader_name):
    hCard, protocol = scard_connect(hContext, reader_name)
    if hCard is None:
        return None
    try:
        data, sw1, sw2 = scard_transmit(hCard, protocol, GET_UID_APDU)
        if sw1 == 0x90 and sw2 == 0x00 and data:
            return data.hex().upper()
        return None
    finally:
        scard_disconnect(hCard)


# ── WebSocket Server ─────────────────────────────────────
WS_HOST = "localhost"
WS_PORT = 8765
POLL_INTERVAL = 0.3
DUPLICATE_TIMEOUT = 3.0

connected_clients = set()
reader_name_global = None


async def broadcast(message):
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
    connected_clients.add(websocket)
    print(f"[WS] Browser connected ({len(connected_clients)})")
    await websocket.send(json.dumps({
        "type": "status",
        "reader": reader_name_global,
        "connected": reader_name_global is not None,
    }))
    try:
        async for _ in websocket:
            pass
    except websockets.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Browser disconnected ({len(connected_clients)})")


def card_poll_loop(loop):
    global reader_name_global
    hContext = None
    last_uid = None
    last_time = 0

    while True:
        # Establish context if needed
        if hContext is None:
            hContext = scard_establish()
            if hContext is None:
                time.sleep(3)
                continue

        # Find reader
        reader = find_reader(hContext)
        if reader != reader_name_global:
            reader_name_global = reader
            connected = reader is not None
            if connected:
                print(f"[Reader] Connected: {reader}")
            else:
                print("[Reader] Not found")
            asyncio.run_coroutine_threadsafe(
                broadcast({"type": "status", "reader": reader, "connected": connected}),
                loop
            )

        if reader is None:
            time.sleep(2)
            continue

        # Read card
        try:
            uid = read_uid(hContext, reader)
            if uid:
                now = time.time()
                if uid == last_uid and (now - last_time) < DUPLICATE_TIMEOUT:
                    pass
                else:
                    last_uid = uid
                    last_time = now
                    print(f"[Card] {uid}")
                    asyncio.run_coroutine_threadsafe(
                        broadcast({"type": "card", "uid": uid}),
                        loop
                    )
        except Exception as e:
            print(f"[Error] {e}")
            scard_release(hContext)
            hContext = None
            reader_name_global = None
            asyncio.run_coroutine_threadsafe(
                broadcast({"type": "status", "reader": None, "connected": False}),
                loop
            )
            time.sleep(2)
            continue

        time.sleep(POLL_INTERVAL)


async def main():
    print("=" * 50)
    print("  ACR122U NFC Reader - WebSocket Server")
    print(f"  ws://{WS_HOST}:{WS_PORT}")
    print("=" * 50)
    print()

    loop = asyncio.get_event_loop()
    poll_thread = threading.Thread(target=card_poll_loop, args=(loop,), daemon=True)
    poll_thread.start()

    print(f"[Server] Waiting for browser (ws://localhost:{WS_PORT})")
    print("[Exit] Ctrl+C")
    print()

    async with serve(ws_handler, WS_HOST, WS_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Exit] NFC server stopped.")
