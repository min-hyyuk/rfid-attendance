/**
 * serial.js - Web Serial API COM 포트 통신 모듈
 * CR100 RFID 리더기: 9600bps, 8N1, 하드웨어 흐름 제어
 * 카드 데이터 형식: \r3F00238493\n → 파싱 후 3F00238493
 */
const SerialReader = (() => {
  let port      = null;
  let reader    = null;
  let isReading = false;
  let buffer    = '';

  // 최근 태그 기록 { cardId → timestamp(ms) }
  const recentTags = new Map();
  const DUPLICATE_MS = 30_000; // 30초 중복 방지

  let onCard   = null;
  let onStatus = null;

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
    // CR(\r), LF(\n) 기준으로 분리
    const lines = buffer.split(/[\r\n]+/);
    buffer = lines.pop(); // 마지막 불완전 조각은 다시 버퍼에

    for (const line of lines) {
      const cardId = parseCardId(line);
      if (cardId.length < 4) continue; // 너무 짧으면 노이즈

      if (isDuplicate(cardId)) {
        console.log(`[SerialReader] 중복 태그 무시: ${cardId}`);
        continue;
      }

      recentTags.set(cardId, Date.now());
      console.log(`[SerialReader] 카드 감지: ${cardId}`);
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

  return {
    /** 카드 태그 이벤트 핸들러 등록 */
    setOnCard(cb) { onCard = cb; },

    /** 상태 변경 핸들러 등록 (status: 'connected'|'disconnected'|'error') */
    setOnStatus(cb) { onStatus = cb; },

    /** COM 포트 연결 */
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
        readLoop(); // await 없이 백그라운드 실행
        return true;
      } catch (err) {
        port     = null;
        isReading = false;
        // 사용자가 취소한 경우는 에러 알림 생략
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

    isConnected() {
      return port !== null;
    },

    /** 중복 방지 캐시 초기화 (테스트용) */
    clearRecentTags() {
      recentTags.clear();
    },
  };
})();
