/**
 * serial.js - 카드 리더기 통신 모듈
 *
 * 두 가지 입력 방식 지원 (동시 사용 가능):
 *   1) Web Serial API — CR100 RFID 리더기 (RS-232, 9600bps 8N1)
 *      → 헤더 [연결] 버튼 클릭으로 수동 연결
 *   2) WebSocket — ACR122U NFC 리더기 (nfc_reader.py 중계 서버)
 *      → 페이지 로드 시 ws://localhost:8765 자동 연결 + 자동 재연결
 */
const SerialReader = (() => {
  let port      = null;
  let reader    = null;
  let isReading = false;
  let buffer    = '';

  // 최근 태그 기록 { cardId → timestamp(ms) }
  const recentTags = new Map();
  const DUPLICATE_MS = 30_000; // 30초 중복 방지

  let onCard      = null;
  let onStatus    = null;
  let onNfcStatus = null;  // NFC WebSocket 상태 콜백

  /* ── WebSocket (ACR122U NFC) ────────────────────────────── */
  const WS_URL        = 'ws://localhost:8765';
  const WS_RETRY_MS   = 5000;  // 재연결 간격
  let ws              = null;
  let wsRetryTimer    = null;
  let nfcReaderName   = null;
  let nfcConnected    = false;

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

    try {
      ws = new WebSocket(WS_URL);
    } catch (e) { scheduleWsRetry(); return; }

    ws.onopen = () => {
      console.log('[NFC-WS] 서버 연결됨');
      if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'status') {
          nfcReaderName = msg.reader || null;
          nfcConnected  = !!msg.connected;
          console.log(`[NFC-WS] 리더기 ${nfcConnected ? '연결: ' + nfcReaderName : '미연결'}`);
          if (onNfcStatus) onNfcStatus(nfcConnected, nfcReaderName);
        }

        if (msg.type === 'card' && msg.uid) {
          handleNfcCard(msg.uid);
        }
      } catch (err) {
        console.warn('[NFC-WS] 메시지 파싱 오류:', err);
      }
    };

    ws.onclose = () => {
      console.log('[NFC-WS] 연결 종료');
      nfcConnected  = false;
      nfcReaderName = null;
      if (onNfcStatus) onNfcStatus(false, null);
      ws = null;
      scheduleWsRetry();
    };

    ws.onerror = () => {
      // onclose에서 처리되므로 여기선 무시
    };
  }

  function scheduleWsRetry() {
    if (wsRetryTimer) return;
    wsRetryTimer = setTimeout(() => {
      wsRetryTimer = null;
      connectWebSocket();
    }, WS_RETRY_MS);
  }

  function handleNfcCard(cardId) {
    if (isDuplicate(cardId)) {
      console.log(`[NFC-WS] 중복 태그 무시: ${cardId}`);
      return;
    }
    recentTags.set(cardId, Date.now());
    console.log(`[NFC-WS] 카드 감지: ${cardId}`);
    if (onCard) onCard(cardId);
  }

  // 페이지 로드 시 WebSocket 자동 연결 시작
  connectWebSocket();

  /* ── Web Serial (CR100 RFID) ────────────────────────────── */

  /** 특수문자 제거 → 순수 카드 ID 추출 */
  function parseCardId(raw) {
    return raw.replace(/[^a-zA-Z0-9]/g, '');
  }

  /** 30초 이내 동일 카드 재태그 여부 */
  function isDuplicate(cardId) {
    const last = recentTags.get(cardId);
    return !!(last && Date.now() - last < DUPLICATE_MS);
  }

  /** 버퍼에서 완전한 라인 추출 후 처리 */
  function processBuffer() {
    const lines = buffer.split(/[\r\n]+/);
    buffer = lines.pop();

    for (const line of lines) {
      const cardId = parseCardId(line);
      if (cardId.length < 4) continue;

      if (isDuplicate(cardId)) {
        console.log(`[Serial] 중복 태그 무시: ${cardId}`);
        continue;
      }

      recentTags.set(cardId, Date.now());
      console.log(`[Serial] 카드 감지: ${cardId}`);
      if (onCard) onCard(cardId);
    }
  }

  /** 비동기 읽기 루프 */
  async function readLoop() {
    const decoder = new TextDecoder();
    while (port && port.readable && isReading) {
      reader = port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }
      } catch (err) {
        if (isReading && onStatus) {
          onStatus('error', `읽기 오류: ${err.message}`);
        }
      } finally {
        try { reader.releaseLock(); } catch {}
        reader = null;
      }
    }
    isReading = false;
  }

  /* ── 공개 API ───────────────────────────────────────────── */
  return {
    /** 카드 태그 이벤트 핸들러 등록 (Serial + NFC 공용) */
    setOnCard(cb) { onCard = cb; },

    /** Serial 상태 변경 핸들러 */
    setOnStatus(cb) { onStatus = cb; },

    /** NFC WebSocket 상태 변경 핸들러 (connected: bool, readerName: string|null) */
    setOnNfcStatus(cb) {
      onNfcStatus = cb;
      // 현재 상태 즉시 콜백
      if (cb) cb(nfcConnected, nfcReaderName);
    },

    /** COM 포트 연결 (CR100) */
    async connect() {
      try {
        port = await navigator.serial.requestPort();
        await port.open({
          baudRate:    9600,
          dataBits:    8,
          parity:      'none',
          stopBits:    1,
          flowControl: 'hardware',
        });
        isReading = true;
        if (onStatus) onStatus('connected', 'COM 포트에 연결되었습니다.');
        readLoop();
        return true;
      } catch (err) {
        port      = null;
        isReading = false;
        if (err.name !== 'NotFoundError') {
          if (onStatus) onStatus('error', `연결 실패: ${err.message}`);
        }
        return false;
      }
    },

    /** COM 포트 연결 해제 */
    async disconnect() {
      isReading = false;
      if (reader) {
        try { await reader.cancel(); } catch {}
        reader = null;
      }
      if (port) {
        try { await port.close(); } catch {}
        port = null;
      }
      buffer = '';
      if (onStatus) onStatus('disconnected', '연결이 해제되었습니다.');
    },

    /** Serial 연결 여부 */
    isConnected() {
      return port !== null;
    },

    /** NFC WebSocket 연결 여부 */
    isNfcConnected() {
      return nfcConnected;
    },

    /** NFC 리더기 이름 */
    getNfcReaderName() {
      return nfcReaderName;
    },

    /** 중복 방지 캐시 초기화 (테스트용) */
    clearRecentTags() {
      recentTags.clear();
    },
  };
})();
