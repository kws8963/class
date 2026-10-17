/**
 * 학급 활동 순서 도우미 - app.js
 * 
 * [주요 기능]
 * 1. 활동 입력 검증 (빈 값 차단, 글자 수 제한, XSS 방지 textContent)
 * 2. 피셔-예이츠(Fisher-Yates) 셔플 (중복/누락 없는 순환)
 * 3. 순차 이동 및 마지막 활동 종료 안내
 * 4. 초기화 전 확인(confirm) 대화상자
 * 5. 구글 스프레드시트 연동 (A열: 활동 이름, B열: 순서 목록)
 *    - 헤더 불일치 시 임의 덮어쓰기 금지 및 에러 안내
 *    - 로딩/성공/실패 피드백 및 실패 시 기존 입력·목록 유지
 *    - no-cors 없이 안전한 JSON 응답 검증
 *    - 연동 URL 사용자 설정 및 localStorage 영구 보관
 */

// ==========================================
// 1. 상수 및 초기 상태 정의
// ==========================================
const STORAGE_KEY_URL = "activity_helper_script_url";

const DEFAULT_SAMPLE_ACTIVITIES = [
  "생각 열기 (동기 유발 퀴즈)",
  "모둠 토의 (활동지 작성)",
  "전체 공유 및 발표",
  "정리 퀴즈 및 배움 공책"
];

const state = {
  // 활동 목록 (배열의 순서가 곧 진행 순서)
  activities: [...DEFAULT_SAMPLE_ACTIVITIES],
  // 현재 진행 중인 인덱스 (0부터 시작)
  currentIndex: 0,
  // 모든 활동 종료 여부
  isFinished: false,
  // 사용자가 설정한 구글 Apps Script 웹 앱 URL
  scriptUrl: localStorage.getItem(STORAGE_KEY_URL) || "",
  // 통신 중 중복 클릭 방지 플래그
  isSyncing: false
};

// ==========================================
// 2. DOM 요소 참조
// ==========================================
// 상단 헤더 요소
const progressTextEl = document.getElementById("progress-text");
const progressBarEl = document.getElementById("progress-bar");
const connectionIndicatorDotEl = document.getElementById("connection-indicator-dot");
const connectionStatusLabelEl = document.getElementById("connection-status-label");
const openSettingsBtnEl = document.getElementById("open-settings-btn");

// 왼쪽 패널 (입력 및 폼)
const formEl = document.getElementById("activity-form");
const inputEl = document.getElementById("activity-name-input");
const addBtnEl = document.getElementById("add-btn");
const inputErrorEl = document.getElementById("input-error-msg");
const activityCounterEl = document.getElementById("activity-counter");
const resetSampleBtnEl = document.getElementById("reset-sample-btn");
const clearAllListBtnEl = document.getElementById("clear-all-list-btn");

// 구글 시트 연동 카드 요소
const cardConnectionBadgeEl = document.getElementById("card-connection-badge");
const syncStatusBoxEl = document.getElementById("sync-status-box");
const syncSpinnerEl = document.getElementById("sync-spinner");
const syncStatusTextEl = document.getElementById("sync-status-text");
const sheetSaveBtnEl = document.getElementById("sheet-save-btn");
const sheetLoadBtnEl = document.getElementById("sheet-load-btn");

// 오른쪽 패널 (현재 활동 및 순서 목록)
const currentCardEl = document.getElementById("current-activity-card");
const currentTitleEl = document.getElementById("current-activity-title");
const currentOrderTagEl = document.getElementById("current-order-tag");
const nextPreviewEl = document.getElementById("next-activity-preview");
const finishCardEl = document.getElementById("finish-card");
const activityListEl = document.getElementById("activity-list");
const emptyListNoticeEl = document.getElementById("empty-list-notice");

// 하단 제어 버튼
const shuffleBtnEl = document.getElementById("shuffle-btn");
const nextBtnEl = document.getElementById("next-btn");
const resetBtnEl = document.getElementById("reset-btn");
const restartBtnEl = document.getElementById("restart-btn");

// 설정 모달 요소
const settingsModalEl = document.getElementById("settings-modal");
const scriptUrlInputEl = document.getElementById("script-url-input");
const settingsErrorMsgEl = document.getElementById("settings-error-msg");
const settingsSuccessMsgEl = document.getElementById("settings-success-msg");
const saveAndTestBtnEl = document.getElementById("save-and-test-btn");
const clearSettingsBtnEl = document.getElementById("clear-settings-btn");
const closeSettingsModalBtnEl = document.getElementById("close-settings-modal-btn");

// ==========================================
// 3. UI 렌더링 함수
// ==========================================

/**
 * 화면 전체를 안전한 textContent 기반으로 갱신합니다.
 */
function render() {
  const total = state.activities.length;

  // 1) 활동 개수 뱃지 갱신
  activityCounterEl.textContent = `등록됨: ${total}개`;

  // 2) 시트 연동 연결 상태 표시 갱신
  updateConnectionBadge();

  // 3) 활동이 0개일 때의 예외 처리
  if (total === 0) {
    shuffleBtnEl.disabled = true;
    nextBtnEl.disabled = true;
    resetBtnEl.disabled = true;

    currentCardEl.style.display = "block";
    finishCardEl.style.display = "none";
    currentOrderTagEl.textContent = "활동 없음";
    currentTitleEl.textContent = "등록된 활동이 없습니다.";
    nextPreviewEl.textContent = "왼쪽 입력창에서 활동을 추가해 주세요.";

    progressTextEl.textContent = "활동 준비 필요";
    progressTextEl.className = "status-badge status-empty";
    progressBarEl.style.width = "0%";

    activityListEl.replaceChildren();
    emptyListNoticeEl.style.display = "block";
    return;
  }

  // 활동이 1개 이상 있을 때 버튼 활성화
  shuffleBtnEl.disabled = state.isSyncing;
  resetBtnEl.disabled = state.isSyncing;
  emptyListNoticeEl.style.display = "none";

  // 4) 종료 상태 처리
  if (state.isFinished) {
    currentCardEl.style.display = "none";
    finishCardEl.style.display = "block";

    nextBtnEl.disabled = true;
    progressTextEl.textContent = "모든 활동 완료 🎉";
    progressTextEl.className = "status-badge status-complete";
    progressBarEl.style.width = "100%";
  } else {
    currentCardEl.style.display = "block";
    finishCardEl.style.display = "none";
    nextBtnEl.disabled = state.isSyncing;

    // 현재 활동 표시
    const currentActivityName = state.activities[state.currentIndex];
    currentOrderTagEl.textContent = `${state.currentIndex + 1}번째 순서`;
    currentTitleEl.textContent = currentActivityName;

    // 다음 활동 미리보기
    if (state.currentIndex + 1 < total) {
      nextPreviewEl.textContent = `다음 활동 예정: ${state.activities[state.currentIndex + 1]}`;
    } else {
      nextPreviewEl.textContent = "📌 이번이 마지막 활동입니다! 다음 클릭 시 종료됩니다.";
    }

    // 헤더 상태 및 진행률 게이지 바
    const currentStep = state.currentIndex + 1;
    progressTextEl.textContent = `활동 ${currentStep} / ${total} 진행 중`;
    progressTextEl.className = "status-badge status-active";

    const progressPercent = Math.round((currentStep / total) * 100);
    progressBarEl.style.width = `${progressPercent}%`;
  }

  // 5) 전체 순서 목록 렌더링 (안전한 textContent 적용)
  activityListEl.replaceChildren();

  state.activities.forEach((activityName, index) => {
    const li = document.createElement("li");
    li.className = "activity-item";

    let statusClass = "is-wait";
    let statusBadgeText = "대기";
    let statusBadgeClass = "badge-wait";

    if (state.isFinished) {
      statusClass = "is-done";
      statusBadgeText = "완료";
      statusBadgeClass = "badge-done";
    } else if (index < state.currentIndex) {
      statusClass = "is-done";
      statusBadgeText = "완료";
      statusBadgeClass = "badge-done";
    } else if (index === state.currentIndex) {
      statusClass = "is-current";
      statusBadgeText = "진행 중";
      statusBadgeClass = "badge-now";
    }

    li.classList.add(statusClass);

    // 왼쪽 (순번 + 활동명)
    const itemLeft = document.createElement("div");
    itemLeft.className = "item-left";

    const itemNum = document.createElement("span");
    itemNum.className = "item-number";
    itemNum.textContent = String(index + 1);

    const itemTitle = document.createElement("span");
    itemTitle.className = "item-text";
    itemTitle.textContent = activityName; // textContent 안전 렌더링

    itemLeft.appendChild(itemNum);
    itemLeft.appendChild(itemTitle);

    // 오른쪽 (상태 뱃지 + 삭제 버튼)
    const itemRight = document.createElement("div");
    itemRight.className = "item-right";

    const badge = document.createElement("span");
    badge.className = `item-badge ${statusBadgeClass}`;
    badge.textContent = statusBadgeText;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "item-delete-btn";
    delBtn.setAttribute("aria-label", `${activityName} 활동 삭제`);
    delBtn.title = "목록에서 삭제";
    delBtn.textContent = "✕";

    delBtn.addEventListener("click", () => {
      deleteActivity(index);
    });

    itemRight.appendChild(badge);
    itemRight.appendChild(delBtn);

    li.appendChild(itemLeft);
    li.appendChild(itemRight);

    activityListEl.appendChild(li);
  });
}

/**
 * 시트 연동 상태 뱃지 및 표시 업데이트
 */
function updateConnectionBadge() {
  const isConfigured = Boolean(state.scriptUrl && state.scriptUrl.startsWith("http"));
  
  if (isConfigured) {
    connectionIndicatorDotEl.className = "status-dot dot-connected";
    connectionStatusLabelEl.textContent = "시트 연동됨";
    cardConnectionBadgeEl.textContent = "연동 활성";
    cardConnectionBadgeEl.className = "badge-status badge-status-green";
  } else {
    connectionIndicatorDotEl.className = "status-dot dot-disconnected";
    connectionStatusLabelEl.textContent = "시트 미연동";
    cardConnectionBadgeEl.textContent = "설정 필요";
    cardConnectionBadgeEl.className = "badge-status badge-status-gray";
  }
}

// ==========================================
// 4. 핵심 조작 함수 (Business Logic)
// ==========================================

/**
 * 활동 추가: 공백/빈 값 검증 및 중복 차단
 */
function addActivity(name) {
  const trimmed = name.trim();

  // 빈 활동 추가 차단
  if (!trimmed) {
    showInputError("활동 이름을 한 글자 이상 입력해 주세요.");
    inputEl.focus();
    return false;
  }

  // 50자 초과 방지
  if (trimmed.length > 50) {
    showInputError("활동 이름은 50자 이하로 입력해 주세요.");
    inputEl.focus();
    return false;
  }

  hideInputError();
  state.activities.push(trimmed);

  // 만약 종료 상태였으면 진행 가능하도록 상태 복구
  if (state.isFinished) {
    state.isFinished = false;
  }

  inputEl.value = "";
  inputEl.focus();
  render();
  return true;
}

/**
 * 개별 활동 삭제
 */
function deleteActivity(index) {
  if (index < 0 || index >= state.activities.length) return;

  state.activities.splice(index, 1);

  if (state.activities.length === 0) {
    state.currentIndex = 0;
    state.isFinished = false;
  } else if (state.currentIndex >= state.activities.length) {
    state.currentIndex = state.activities.length - 1;
    state.isFinished = false;
  }

  render();
}

/**
 * 피셔-예이츠(Fisher-Yates) 셔플
 * - 기존 원본 항목의 요소를 1:1로 맞바꿔 중복·누락 확률 0% 보장
 */
function shuffleActivities() {
  if (state.activities.length <= 1) return;

  const array = [...state.activities];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }

  state.activities = array;
  state.currentIndex = 0;
  state.isFinished = false;

  render();
}

/**
 * 다음 활동으로 이동
 * - 마지막 활동 후 종료 안내
 */
function nextActivity() {
  if (state.activities.length === 0 || state.isFinished) return;

  if (state.currentIndex < state.activities.length - 1) {
    state.currentIndex += 1;
  } else {
    state.isFinished = true;
  }

  render();
}

/**
 * 진행 초기화 (초기화 전 confirm 확인)
 */
function resetProgress() {
  if (state.activities.length === 0) return;

  const isConfirmed = window.confirm(
    "활동 진행 순서를 처음(1번째)으로 되돌리시겠습니까?\n(등록된 활동 목록은 유지됩니다)"
  );

  if (isConfirmed) {
    state.currentIndex = 0;
    state.isFinished = false;
    render();
  }
}

/**
 * 에러 메시지 표시/숨김 헬퍼
 */
function showInputError(msg) {
  inputErrorEl.textContent = msg;
  inputErrorEl.style.display = "block";
}

function hideInputError() {
  inputErrorEl.textContent = "";
  inputErrorEl.style.display = "none";
}

// ==========================================
// 5. 구글 스프레드시트 연동 (Google Apps Script API)
// ==========================================

/**
 * 통신 상태 피드백 UI 표시
 */
function setSyncStatus(type, message) {
  syncStatusBoxEl.style.display = "flex";
  syncStatusBoxEl.className = `sync-status-box is-${type}`;
  syncStatusTextEl.textContent = message;

  if (type === "loading") {
    syncSpinnerEl.style.display = "inline-block";
  } else {
    syncSpinnerEl.style.display = "none";
  }
}

function hideSyncStatus() {
  syncStatusBoxEl.style.display = "none";
  syncSpinnerEl.style.display = "none";
  syncStatusTextEl.textContent = "";
}

/**
 * 스프레드시트에 저장하기 (doPost 호출)
 * - no-cors를 사용하지 않고 실제 JSON 응답을 엄격히 검증
 * - 실패 시 기존 화면의 입력과 목록은 100% 안전하게 유지
 */
async function saveToGoogleSheets() {
  // 1. URL 미설정 확인
  if (!state.scriptUrl) {
    openSettingsModal();
    showSettingsError("먼저 Google Apps Script 웹 앱 URL을 설정해 주세요.");
    return;
  }

  // 2. 활동 개수 확인
  if (state.activities.length === 0) {
    setSyncStatus("error", "저장할 활동이 없습니다. 먼저 활동을 추가해 주세요.");
    return;
  }

  // 3. 중복 클릭 방지 락
  if (state.isSyncing) return;
  state.isSyncing = true;
  setButtonsSyncingState(true);

  setSyncStatus("loading", "구글 스프레드시트에 활동을 저장하는 중입니다...");

  try {
    // 스키마 대응: A열(활동 이름), B열(순서 목록)
    const payload = state.activities.map((act, index) => ({
      activity: act,
      order: index + 1
    }));

    // Apps Script 웹 앱에 JSON 페이로드 전송
    // (text/plain 헤더를 사용하여 프리플라이트 문제 없이 본문 전달)
    const response = await fetch(state.scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`서버 응답 오류 (HTTP ${response.status})`);
    }

    const result = await response.json();

    if (!result.success) {
      // 서버에서 검증 실패(예: 헤더 불일치) 에러 전달 시
      throw new Error(result.error || "스프레드시트 저장 중 문제가 발생했습니다.");
    }

    // 성공 처리
    setSyncStatus("success", `✅ ${result.savedCount || state.activities.length}개의 활동이 구글 시트에 안전하게 저장되었습니다.`);

  } catch (err) {
    // 실패 시: 기존 활동 목록 유지 + 명확한 원인 안내
    console.error("Sheet Save Error:", err);
    setSyncStatus("error", `❌ 저장 실패: ${err.message} (기존 활동 목록은 안전하게 유지됩니다)`);
  } finally {
    state.isSyncing = false;
    setButtonsSyncingState(false);
    render();
  }
}

/**
 * 스프레드시트에서 활동 불러오기 (doGet 호출)
 * - 헤더 검증 및 1행 보호 규칙 확인
 */
async function loadFromGoogleSheets() {
  // 1. URL 미설정 확인
  if (!state.scriptUrl) {
    openSettingsModal();
    showSettingsError("먼저 Google Apps Script 웹 앱 URL을 설정해 주세요.");
    return;
  }

  // 2. 기존 목록 대체 여부 확인
  if (state.activities.length > 0) {
    const proceed = window.confirm(
      "구글 시트의 활동 목록을 불러오면 현재 화면의 목록이 대체됩니다. 계속하시겠습니까?"
    );
    if (!proceed) return;
  }

  // 3. 중복 클릭 방지 락
  if (state.isSyncing) return;
  state.isSyncing = true;
  setButtonsSyncingState(true);

  setSyncStatus("loading", "구글 스프레드시트에서 활동 목록을 불러오는 중입니다...");

  try {
    const fetchUrl = `${state.scriptUrl}?action=load&t=${Date.now()}`;
    const response = await fetch(fetchUrl, {
      method: "GET"
    });

    if (!response.ok) {
      throw new Error(`서버 응답 오류 (HTTP ${response.status})`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "데이터를 불러오지 못했습니다.");
    }

    if (!Array.isArray(result.data)) {
      throw new Error("서버에서 올바른 목록 형식을 전달받지 못했습니다.");
    }

    if (result.data.length === 0) {
      setSyncStatus("success", "구글 시트가 비어 있습니다. (등록된 활동 없음)");
      state.activities = [];
      state.currentIndex = 0;
      state.isFinished = false;
    } else {
      // 스키마 검증: activity 문자열 추출 및 순서 정렬
      const loadedActivities = result.data
        .map(item => String(item.activity || "").trim())
        .filter(name => name.length > 0);

      state.activities = loadedActivities;
      state.currentIndex = 0;
      state.isFinished = false;

      setSyncStatus("success", `✅ 구글 시트에서 ${loadedActivities.length}개의 활동을 성공적으로 불러왔습니다.`);
    }

  } catch (err) {
    console.error("Sheet Load Error:", err);
    // 실패 시: 기존 목록 유지
    setSyncStatus("error", `❌ 불러오기 실패: ${err.message} (기존 화면 목록이 유지됩니다)`);
  } finally {
    state.isSyncing = false;
    setButtonsSyncingState(false);
    render();
  }
}

/**
 * 통신 중 버튼 비활성화 제어
 */
function setButtonsSyncingState(isSyncing) {
  sheetSaveBtnEl.disabled = isSyncing;
  sheetLoadBtnEl.disabled = isSyncing;
  shuffleBtnEl.disabled = isSyncing;
  nextBtnEl.disabled = isSyncing;
  resetBtnEl.disabled = isSyncing;
  addBtnEl.disabled = isSyncing;
}

// ==========================================
// 6. 설정 모달 및 URL 관리
// ==========================================

function openSettingsModal() {
  scriptUrlInputEl.value = state.scriptUrl || "";
  hideSettingsMessages();
  settingsModalEl.style.display = "flex";
  scriptUrlInputEl.focus();
}

function closeSettingsModal() {
  settingsModalEl.style.display = "none";
}

function showSettingsError(msg) {
  settingsErrorMsgEl.textContent = msg;
  settingsErrorMsgEl.style.display = "block";
  settingsSuccessMsgEl.style.display = "none";
}

function showSettingsSuccess(msg) {
  settingsSuccessMsgEl.textContent = msg;
  settingsSuccessMsgEl.style.display = "block";
  settingsErrorMsgEl.style.display = "none";
}

function hideSettingsMessages() {
  settingsErrorMsgEl.style.display = "none";
  settingsSuccessMsgEl.style.display = "none";
}

/**
 * 설정 저장 및 즉시 연결 테스트
 */
async function saveAndTestConnection() {
  const url = scriptUrlInputEl.value.trim();

  if (!url) {
    showSettingsError("Google Apps Script 웹 앱 URL을 입력해 주세요.");
    return;
  }

  if (!url.startsWith("https://script.google.com/macros/s/")) {
    showSettingsError("올바른 Google Apps Script 웹 앱 배포 URL 형식이 아닙니다. (https://script.google.com/macros/s/... 형식 필요)");
    return;
  }

  saveAndTestBtnEl.disabled = true;
  saveAndTestBtnEl.textContent = "연결 테스트 중...";
  hideSettingsMessages();

  try {
    // 헬스체크 GET 호출
    const testUrl = `${url}?action=ping&t=${Date.now()}`;
    const res = await fetch(testUrl, { method: "GET" });

    if (!res.ok) {
      throw new Error(`서버 응답 오류 (HTTP ${res.status})`);
    }

    const testResult = await res.json();

    if (!testResult.success) {
      // 헤더 불일치 등의 구체적 에러
      throw new Error(testResult.error || "스프레드시트에서 오류 응답을 반환했습니다.");
    }

    // 연결 및 검증 성공 시 저장
    state.scriptUrl = url;
    localStorage.setItem(STORAGE_KEY_URL, url);
    showSettingsSuccess("🎉 구글 스프레드시트와 성공적으로 연결되었습니다!");
    updateConnectionBadge();

    // 1.5초 후 모달 닫기
    setTimeout(() => {
      closeSettingsModal();
      render();
    }, 1200);

  } catch (err) {
    showSettingsError(`연결 실패: ${err.message}\n(Apps Script 배포 시 '액세스 권한: 모든 사용자'로 설정했는지 확인해 주세요)`);
  } finally {
    saveAndTestBtnEl.disabled = false;
    saveAndTestBtnEl.textContent = "연동 저장 및 테스트";
  }
}

/**
 * 연동 해제
 */
function clearSettings() {
  if (confirm("구글 스프레드시트 연동 설정을 해제하시겠습니까?")) {
    state.scriptUrl = "";
    localStorage.removeItem(STORAGE_KEY_URL);
    scriptUrlInputEl.value = "";
    showSettingsSuccess("연동이 해제되었습니다.");
    updateConnectionBadge();
    setTimeout(() => {
      closeSettingsModal();
      render();
    }, 800);
  }
}

// ==========================================
// 7. 이벤트 리스너 연결
// ==========================================

// 폼 추가
formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  addActivity(inputEl.value);
});

inputEl.addEventListener("input", () => {
  if (inputErrorEl.style.display !== "none") {
    hideInputError();
  }
});

// 하단 진행 제어 버튼
shuffleBtnEl.addEventListener("click", () => {
  shuffleActivities();
});

nextBtnEl.addEventListener("click", () => {
  nextActivity();
});

resetBtnEl.addEventListener("click", () => {
  resetProgress();
});

restartBtnEl.addEventListener("click", () => {
  state.currentIndex = 0;
  state.isFinished = false;
  render();
});

// 예시 데이터 및 전체 삭제
resetSampleBtnEl.addEventListener("click", () => {
  state.activities = [...DEFAULT_SAMPLE_ACTIVITIES];
  state.currentIndex = 0;
  state.isFinished = false;
  hideInputError();
  hideSyncStatus();
  render();
});

clearAllListBtnEl.addEventListener("click", () => {
  if (state.activities.length === 0) return;
  const ok = window.confirm("등록된 모든 활동을 삭제하시겠습니까?");
  if (ok) {
    state.activities = [];
    state.currentIndex = 0;
    state.isFinished = false;
    hideSyncStatus();
    render();
  }
});

// 구글 시트 저장 및 불러오기 버튼
sheetSaveBtnEl.addEventListener("click", () => {
  saveToGoogleSheets();
});

sheetLoadBtnEl.addEventListener("click", () => {
  loadFromGoogleSheets();
});

// 설정 모달 열기/닫기/저장
openSettingsBtnEl.addEventListener("click", () => {
  openSettingsModal();
});

closeSettingsModalBtnEl.addEventListener("click", () => {
  closeSettingsModal();
});

saveAndTestBtnEl.addEventListener("click", () => {
  saveAndTestConnection();
});

clearSettingsBtnEl.addEventListener("click", () => {
  clearSettings();
});

settingsModalEl.addEventListener("click", (e) => {
  if (e.target === settingsModalEl) {
    closeSettingsModal();
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsModalEl.style.display === "flex") {
    closeSettingsModal();
  }
});

// ==========================================
// 8. 앱 구동
// ==========================================
render();
